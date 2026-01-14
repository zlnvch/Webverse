package worker

import (
	"context"
	"log"
	"time"

	"github.com/zlnvch/webverse/models"
	"github.com/zlnvch/webverse/store"
)

type DeleteStrokeRequest struct {
	StrokeId string
	UserId   string
}

type BatchedStroke struct {
	Record         models.StrokeRecord
	UserProvider   string
	UserProviderId string
}

type StrokeBatcher struct {
	WriteCh            chan BatchedStroke
	DeleteCh           chan DeleteStrokeRequest
	webverseStore      store.WebverseStore
	counterBatcher     *CounterBatcher
	tickerMilliseconds int
}

// Note: Deletes are NOT batched for persistence because DynamoDB BatchWriteItem
// does not support ConditionExpression. We need conditional deletes to ensure
// users can only delete their own strokes (UserId check).
// deleteCh is only used here to remove *pending* writes from the buffer
// before they are flushed, effectively cancelling the write.
func NewStrokeBatcher(webverseStore store.WebverseStore, tickerMilliseconds int, counterBatcher *CounterBatcher) *StrokeBatcher {
	return &StrokeBatcher{
		WriteCh:            make(chan BatchedStroke, 1024), // buffer to absorb bursts
		DeleteCh:           make(chan DeleteStrokeRequest, 1024),
		webverseStore:      webverseStore,
		counterBatcher:     counterBatcher,
		tickerMilliseconds: tickerMilliseconds,
	}
}

func (b *StrokeBatcher) Run(shutdownCtx context.Context) {
	ticker := time.NewTicker(time.Duration(b.tickerMilliseconds) * time.Millisecond)
	defer ticker.Stop()

	batch := make([]models.StrokeRecord, 0, 25)
	// We need to keep the metadata associated with the stroke ID to pass it to counter later
	batchMeta := make(map[string]BatchedStroke, 25)
	batchIndices := make(map[string]int, 25)

	flush := func() {
		if len(batch) == 0 {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		// Explicitly ignore cancel to satisfy linter
		// In this case, we don't want to defer cancel(),
		// when shutdownCtx causes this function to return
		// any pending batch writes should finish
		_ = cancel
		unprocessed, err := b.webverseStore.WriteStrokeBatch(ctx, batch)

		if err != nil {
			log.Printf("Error writing stroke batch to dynamo: %v", err)
		}

		// Calculate successes: Everything in batch MINUS unprocessed
		failedMap := make(map[string]bool)
		for _, u := range unprocessed {
			failedMap[u.Stroke.Id] = true
		}

		for _, s := range batch {
			if !failedMap[s.Stroke.Id] {
				// Success!
				// Retrieve provider info from local map
				if meta, ok := batchMeta[s.Stroke.Id]; ok {
					b.counterBatcher.UpdateCh <- CounterUpdate{
						UserProvider:   meta.UserProvider,
						UserProviderId: meta.UserProviderId,
						Delta:          1,
					}
				}
			}
		}

		batch = batch[:0]
		clear(batchIndices)
		clear(batchMeta)
	}

	for {
		select {
		case item := <-b.WriteCh:
			batch = append(batch, item.Record)
			batchIndices[item.Record.Stroke.Id] = len(batch) - 1
			batchMeta[item.Record.Stroke.Id] = item
			if len(batch) == 25 {
				flush()
			}

		case deleteReq := <-b.DeleteCh:
			if idx, ok := batchIndices[deleteReq.StrokeId]; ok {
				if batch[idx].Stroke.UserId == deleteReq.UserId {
					l := len(batch)
					batch[idx] = batch[l-1]
					batch = batch[:l-1]

					// Update index of the moved item
					if idx < len(batch) {
						batchIndices[batch[idx].Stroke.Id] = idx
					}

					delete(batchIndices, deleteReq.StrokeId)
					delete(batchMeta, deleteReq.StrokeId)
				} else {
					// This means they maliciously sent a delete message with a different user's strokeId
					// TODO: ban user?
				}
			}

		case <-ticker.C:
			flush()

		case <-shutdownCtx.Done():
			flush()
			return
		}
	}
}
