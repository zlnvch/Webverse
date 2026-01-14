package service

import (
	"context"
	"encoding/json"

	"github.com/zlnvch/webverse/cache"
	"github.com/zlnvch/webverse/models"
)

func (s *Service) LoadPage(ctx context.Context, pageKey string, layer models.LayerType) ([]models.Stroke, error) {
	if err := ValidatePageKey(pageKey, layer == models.LayerPrivate); err != nil {
		return nil, err
	}

	redisStrokesRaw, err := s.Cache.GetStrokes(ctx, pageKey)
	redisStrokes := []models.Stroke{}
	if err == nil {
		for _, b := range redisStrokesRaw {
			var stroke models.Stroke
			if err := json.Unmarshal(b, &stroke); err == nil {
				redisStrokes = append(redisStrokes, stroke)
			}
		}
	}

	isComplete, _ := s.Cache.IsPageComplete(ctx, pageKey)
	if isComplete && err == nil {
		return redisStrokes, nil
	}

	// Fallback to DynamoDB + Merge with Redis
	dbStrokes, err := s.Store.GetStrokeRecords(ctx, pageKey)
	if err != nil {
		return nil, err
	}

	finalStrokes := mergeStrokes(dbStrokes, redisStrokes)

	// Fetch newest 1100 strokes
	// There should be only 1000 or a little more, but just to be safe, we will enforce 1100 limit here
	if len(finalStrokes) > 1100 {
		finalStrokes = finalStrokes[len(finalStrokes)-1100:]
	}

	batchItems := make([]cache.StrokeCacheItem, 0, len(dbStrokes))
	for _, stroke := range dbStrokes {
		sBytes, _ := json.Marshal(stroke)
		t, _ := getTimeFromUUIDv7(stroke.Id)
		batchItems = append(batchItems, cache.StrokeCacheItem{
			StrokeId: stroke.Id,
			Score:    t.UnixMilli(),
			Data:     sBytes,
		})
	}

	if len(batchItems) > 0 {
		s.Cache.AddStrokesBatch(ctx, pageKey, batchItems)
	} else {
		// Mark as complete even if currently empty
		s.Cache.SetPageComplete(ctx, pageKey)
	}

	return finalStrokes, nil
}

func mergeStrokes(dbStrokes []models.Stroke, redisStrokes []models.Stroke) []models.Stroke {
	finalStrokes := make([]models.Stroke, 0, len(dbStrokes)+len(redisStrokes))
	i, j := 0, 0
	for i < len(dbStrokes) && j < len(redisStrokes) {
		dbId := dbStrokes[i].Id
		redisId := redisStrokes[j].Id

		if dbId == redisId {
			finalStrokes = append(finalStrokes, redisStrokes[j])
			i++
			j++
		} else if dbId < redisId {
			finalStrokes = append(finalStrokes, dbStrokes[i])
			i++
		} else {
			finalStrokes = append(finalStrokes, redisStrokes[j])
			j++
		}
	}
	if i < len(dbStrokes) {
		finalStrokes = append(finalStrokes, dbStrokes[i:]...)
	}
	if j < len(redisStrokes) {
		finalStrokes = append(finalStrokes, redisStrokes[j:]...)
	}
	return finalStrokes
}
