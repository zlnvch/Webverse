package service

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strconv"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/zlnvch/webverse/models"
	"github.com/zlnvch/webverse/store"
	"github.com/zlnvch/webverse/worker"
)

const (
	maxUserStrokes = 100000
	maxPageStrokes = 1000
)

func (s *Service) enforceUserAndPageQuota(ctx context.Context, user models.User, pageKey string, layer models.LayerType) error {
	// Check User Quota
	userStrokeCount, err := s.Cache.GetUserStrokeCount(ctx, user.Id)
	if err != nil {
		if userStrokeCount == -1 {
			// Cache Miss: Fetch from DB
			user, err = s.Store.GetUser(ctx, user.Provider, user.ProviderId)
			if err != nil {
				return err
			}
			s.Cache.SeedUserStrokeCount(ctx, user.Id, user.StrokeCount)
			// CRITICAL: Must update userStrokeCount after cache miss
			// Previous bug: userStrokeCount stayed -1, allowing quota bypass
			// Regression test: TestDrawStroke_QuotaExceeded_User_CacheMiss
			userStrokeCount = user.StrokeCount
		} else {
			return err
		}
	}
	if userStrokeCount >= maxUserStrokes {
		log.Printf("User %s exceeded stroke quota (%d)", user.Id, userStrokeCount)
		return errors.New("user stroke quota exceeded")
	}

	// Check Page Quota using ZCard
	// If page is not in cache, load it first
	isComplete, _ := s.Cache.IsPageComplete(ctx, pageKey)
	if !isComplete {
		_, err := s.LoadPage(ctx, pageKey, layer)
		if err != nil {
			log.Printf("Failed to load page %s for quota check: %v", pageKey, err)
			// Continue anyway - if we can't load, assume 0 strokes
		}
	}

	pageStrokeCount, err := s.Cache.GetPageStrokeCountFromZCard(ctx, pageKey)
	if err != nil {
		// If ZCard fails, assume 0 strokes
		pageStrokeCount = 0
	}
	if pageStrokeCount >= maxPageStrokes {
		log.Printf("Page %s exceeded stroke quota (%d)", pageKey, pageStrokeCount)
		return errors.New("page stroke quota exceeded")
	}
	return nil
}

type DrawParams struct {
	User         models.User
	PageKey      string
	Layer        models.LayerType
	LayerId      string
	Stroke       models.Stroke
	UserStrokeId uint32
	IsRedo       bool
}
type NewStrokeMessage struct {
	Type string        `json:"type"`
	Data NewStrokeData `json:"data"`
}

type NewStrokeData struct {
	PageKey string           `json:"pageKey"`
	Layer   models.LayerType `json:"layer"`
	LayerId string           `json:"layerId"`
	Stroke  models.Stroke    `json:"stroke"`
}

func (s *Service) DrawStroke(ctx context.Context, params DrawParams) (string, error) {
	// 1. Validation
	isPrivate := params.Layer == models.LayerPrivate
	if err := ValidatePageKey(params.PageKey, isPrivate); err != nil {
		return "", err
	}

	if !isPrivate {
		// Stroke content can only be validated for public (unencrypted) strokes
		if err := ValidateStrokeContent(params.Stroke.Content); err != nil {
			return "", err
		}
	} else {
		// Ensure the frontend has the user's latest encryption keys
		// Otherwise, it will write strokes that they will be unable to decrypt later
		if params.LayerId != strconv.Itoa(params.User.KeyVersion) {
			return "", errors.New("stroke was encrypted with an older encryption key")
		}
	}

	// 2. Quota Enforcement
	if err := s.enforceUserAndPageQuota(ctx, params.User, params.PageKey, params.Layer); err != nil {
		return "", err
	}

	// 3. ID Generation
	var (
		strokeUUID uuid.UUID
		err        error
	)
	if params.IsRedo {
		var t time.Time
		t, err := getTimeFromUUIDv7(params.Stroke.Id)
		if err != nil {
			return "", err
		}

		if t.After(time.Now()) {
			return "", errors.New("redo stroke uuidv7 has time greater than current time")
			// This means they maliciously sent a redo message with a uuidv7 with a timestamp in the future
			// TODO: ban user?
		}
		strokeUUID, err = uuid.NewV7AtTime(t)
	} else {
		strokeUUID, err = uuid.NewV7()
	}

	if err != nil {
		return "", err
	}

	strokeId := strokeUUID.String()
	params.Stroke.Id = strokeId
	params.Stroke.UserId = params.User.Id

	// Async side-effects - return to caller as soon as as strokeId is generated
	go func() {
		// 4. Increment User Counter
		s.Cache.IncrementUserStrokeCount(context.Background(), params.User.Id)
		// Note: Page counter comes from ZCard, no separate increment needed

		// 5. Add to Stroke Batcher
		s.StrokeBatcher.WriteCh <- worker.BatchedStroke{
			Record: models.StrokeRecord{
				PageKey: params.PageKey,
				Stroke:  params.Stroke,
				Layer:   params.Layer,
				LayerId: params.LayerId,
			},
			UserProvider:   params.User.Provider,
			UserProviderId: params.User.ProviderId,
		}

		// 6. Add to Cache
		strokeBytes, err := json.Marshal(params.Stroke)
		if err == nil {
			t, _ := getTimeFromUUIDv7(strokeId)
			s.Cache.AddStroke(ctx, params.PageKey, strokeId, t.UnixMilli(), strokeBytes)
		}

		// 7. Broadcast New Stroke
		newStrokeData := NewStrokeData{
			PageKey: params.PageKey,
			Layer:   params.Layer,
			LayerId: params.LayerId,
			Stroke:  params.Stroke,
		}
		msg := NewStrokeMessage{
			Type: "new_stroke",
			Data: newStrokeData,
		}
		// TODO: the service layer is broadcasting the message in the format the WS client expects
		// This is a bit of leaking of responsibilities
		// Ideally, we should just send the delete data, and the hub should format it the way the client expects
		// In which case, we would need to separate the pub-sub into two separate channels, one for draw and one for delete
		// or create a message format for between the service layer and the hub, and the hub switches on message type
		msgBytes, _ := json.Marshal(msg)
		s.Cache.Publish(ctx, "page:"+params.PageKey, msgBytes)
	}()

	return strokeId, nil
}

type UndoParams struct {
	User     models.User
	PageKey  string
	Layer    models.LayerType
	LayerId  string
	StrokeId string
}

type DeleteStrokeMessage struct {
	Type string           `json:"type"`
	Data DeleteStrokeData `json:"data"`
}

type DeleteStrokeData struct {
	PageKey  string           `json:"pageKey"`
	Layer    models.LayerType `json:"layer"`
	LayerId  string           `json:"layerId"`
	StrokeId string           `json:"strokeId"`
	UserId   string           `json:"userId"`
}

func (s *Service) UndoStroke(ctx context.Context, params UndoParams) error {
	// 1. Validate page key
	isPrivate := params.Layer == models.LayerPrivate
	if err := ValidatePageKey(params.PageKey, isPrivate); err != nil {
		return err
	}

	// 2. Remove from Stroke Batcher (if pending)
	s.StrokeBatcher.DeleteCh <- worker.DeleteStrokeRequest{
		StrokeId: params.StrokeId,
		UserId:   params.User.Id,
	}

	// 3. Delete from Store
	err := s.Store.DeleteStroke(ctx, params.PageKey, params.StrokeId, params.User.Id)
	if err != nil && err == store.ErrConditionFailed {
		// This means they maliciously sent a delete message with a different user's strokeId
		// TODO: ban user?
	}

	if err != store.ErrConditionFailed {
		// Async side-effects - return to caller as soon as as store operation is done
		go func() {
			// 4. Remove from Cache
			s.Cache.RemoveStroke(context.Background(), params.PageKey, params.StrokeId)

			// 5. Broadcast Delete Stroke
			deleteStrokeData := DeleteStrokeData{
				PageKey:  params.PageKey,
				Layer:    params.Layer,
				LayerId:  params.LayerId,
				StrokeId: params.StrokeId,
				UserId:   params.User.Id,
			}
			msg := DeleteStrokeMessage{
				Type: "delete_stroke",
				Data: deleteStrokeData,
			}
			// TODO: same as new stroke broadcast above
			msgBytes, _ := json.Marshal(msg)
			s.Cache.Publish(context.Background(), "page:"+params.PageKey, msgBytes)

			// 6. Decrement User Counter
			s.Cache.DecrementUserStrokeCount(context.Background(), params.User.Id)
			// Note: Page counter comes from ZCard, no separate decrement needed
		}()
	}

	return err
}

func getTimeFromUUIDv7(strokeId string) (time.Time, error) {
	id, err := uuid.FromString(strokeId)
	if err != nil || id.Version() != uuid.V7 {
		return time.Time{}, err
	}
	ts, err := uuid.TimestampFromV7(id)
	if err != nil {
		return time.Time{}, err
	}
	return ts.Time()
}
