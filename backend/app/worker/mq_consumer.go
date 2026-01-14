package worker

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/zlnvch/webverse/cache"
	"github.com/zlnvch/webverse/mq"
	"github.com/zlnvch/webverse/store"
)

type DeleteUserStrokesMessage struct {
	UserId         string `json:"userId"`
	UserProvider   string `json:"userProvider"`
	UserProviderId string `json:"userProviderId"`
	DeleteAll      bool   `json:"deleteAll"`
	Layer          string `json:"layer"`
}

type MQConsumer struct {
	deleteUserStrokesQueue mq.MessageQueue
	webverseStore          store.WebverseStore
	webverseCache          cache.WebverseCache
	counterBatcher         *CounterBatcher
}

func NewMQConsumer(deleteUserStrokesQueue mq.MessageQueue, webverseStore store.WebverseStore, webverseCache cache.WebverseCache, counterBatcher *CounterBatcher) *MQConsumer {
	return &MQConsumer{
		deleteUserStrokesQueue: deleteUserStrokesQueue,
		webverseStore:          webverseStore,
		webverseCache:          webverseCache,
		counterBatcher:         counterBatcher,
	}
}

// Allow up to 5 minutes for the throttled batch deletion of all the user's pages
const visibilityTimeout = 300

func (mqConsumer MQConsumer) Run(shutdownCtx context.Context) {
	for {
		msg, err := mqConsumer.deleteUserStrokesQueue.Receive(shutdownCtx, visibilityTimeout)

		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return
			}
			log.Printf("mqConsumer receive error: %v", err)
			continue
		}

		if msg == nil {
			continue
		}

		var deleteMsg DeleteUserStrokesMessage
		if err := json.Unmarshal([]byte(msg.Body), &deleteMsg); err != nil {
			continue
		}

		// timeout should be a little less than queue visibility timeout
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(visibilityTimeout-1)*time.Second)
		defer cancel()

		if deleteMsg.DeleteAll {
			// Full account delete: need to get affected pages for cache invalidation
			pages, err := mqConsumer.webverseStore.GetUserPages(ctx, deleteMsg.UserId)
			if err != nil {
				log.Printf("Failed to get user pages: %v", err)
			}

			// Delete strokes
			err = mqConsumer.webverseStore.DeleteUserStrokes(ctx, deleteMsg.UserId, "")

			// Invalidate cache (so pages reload with correct counts from ZCard)
			if err == nil && pages != nil {
				if err := mqConsumer.webverseCache.InvalidatePages(ctx, pages); err != nil {
					log.Printf("Failed to invalidate pages: %v", err)
				}
			}
		} else {
			// Layer-specific delete (e.g., old encryption keys)
			// Count strokes to decrement user counter
			totalDeleted, countErr := mqConsumer.webverseStore.GetUserStrokeCount(ctx, deleteMsg.UserId, deleteMsg.Layer)
			if countErr != nil {
				log.Printf("Failed to get user stroke count for layer %s: %v", deleteMsg.Layer, countErr)
			}

			// Delete strokes
			err = mqConsumer.webverseStore.DeleteUserStrokes(ctx, deleteMsg.UserId, deleteMsg.Layer)

			// Decrement user counter (these are private strokes, no cache invalidation needed)
			if err == nil && totalDeleted > 0 {
				mqConsumer.counterBatcher.UpdateCh <- CounterUpdate{
					UserProvider:   deleteMsg.UserProvider,
					UserProviderId: deleteMsg.UserProviderId,
					Delta:          -totalDeleted,
				}
				log.Printf("Deleted %d strokes from layer %s for user %s", totalDeleted, deleteMsg.Layer, deleteMsg.UserId)
			}
		}

		if err != nil {
			log.Printf("webverseStore delete user strokes error: %v", err)
			continue
		}

		err = mqConsumer.deleteUserStrokesQueue.Delete(context.Background(), msg)
		if err != nil {
			log.Printf("mqConsumer delete error: %v", err)
			continue
		}
	}
}
