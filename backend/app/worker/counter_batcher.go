package worker

import (
	"context"
	"log"
	"time"

	"github.com/zlnvch/webverse/store"
)

type CounterUpdate struct {
	UserId         string // Kept for logging/reference
	UserProvider   string
	UserProviderId string
	Delta          int
}

type CounterBatcher struct {
	UpdateCh           chan CounterUpdate
	webverseStore      store.WebverseStore
	tickerMilliseconds int
}

func NewCounterBatcher(webverseStore store.WebverseStore, tickerMilliseconds int) *CounterBatcher {
	return &CounterBatcher{
		UpdateCh:           make(chan CounterUpdate, 1024),
		webverseStore:      webverseStore,
		tickerMilliseconds: tickerMilliseconds,
	}
}

func (b *CounterBatcher) Run(shutdownCtx context.Context) {
	ticker := time.NewTicker(time.Duration(b.tickerMilliseconds) * time.Millisecond)
	defer ticker.Stop()

	// Key: "provider#providerId" -> count
	userCounts := make(map[string]int)
	// Map to store separated keys for the flush loop
	type providerKeys struct {
		p  string
		id string
	}
	userKeys := make(map[string]providerKeys)

	flush := func() {
		// Flush Users
		for key, count := range userCounts {
			if count == 0 {
				continue
			}
			pk := userKeys[key]
			go func(p string, pid string, c int) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := b.webverseStore.IncrementUserStrokeCount(ctx, p, pid, c); err != nil {
					log.Printf("Failed to update stroke count for user %s#%s: %v", p, pid, err)
				}
			}(pk.p, pk.id, count)
		}
		// Reset User Maps
		userCounts = make(map[string]int)
		userKeys = make(map[string]providerKeys)
	}

	for {
		select {
		case update := <-b.UpdateCh:
			if update.UserProvider != "" && update.UserProviderId != "" {
				key := update.UserProvider + "#" + update.UserProviderId
				userCounts[key] += update.Delta
				userKeys[key] = providerKeys{p: update.UserProvider, id: update.UserProviderId}
			}

			if len(userCounts) >= 100 {
				flush()
			}

		case <-ticker.C:
			flush()

		case <-shutdownCtx.Done():
			flush()
			return
		}
	}
}
