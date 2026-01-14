package ws

import (
	"context"
	"encoding/json"
	"log"

	"github.com/zlnvch/webverse/cache"
	"github.com/zlnvch/webverse/service"
)

type subscription struct {
	client  *Client
	pageKey string
}

type keysUpdatedData struct {
	KeyVersion  int  `json:"keyVersion"`
	KeysDeleted bool `json:"keysDeleted"`
}

type keysUpdatedMessage struct {
	Type string          `json:"type"`
	Data keysUpdatedData `json:"data"`
}

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	webverseCache          cache.WebverseCache
	OpenCh                 chan *Client
	CloseCh                chan *Client
	SubscribeCh            chan subscription
	UnsubscribeCh          chan subscription
	UserDeletedCh          chan string
	UserKeysUpdatedCh      chan service.UserKeysUpdatedMessage
	userToClients          map[string]map[*Client]struct{}
	pageToClients          map[string]map[*Client]struct{}
	pageToSubscriberCancel map[string]context.CancelFunc
}

func NewHub(webverseCache cache.WebverseCache) *Hub {
	return &Hub{
		webverseCache:          webverseCache,
		OpenCh:                 make(chan *Client, 256),
		CloseCh:                make(chan *Client, 256),
		SubscribeCh:            make(chan subscription, 1024),
		UnsubscribeCh:          make(chan subscription, 1024),
		UserDeletedCh:          make(chan string, 64),
		UserKeysUpdatedCh:      make(chan service.UserKeysUpdatedMessage, 64),
		userToClients:          make(map[string]map[*Client]struct{}),
		pageToClients:          make(map[string]map[*Client]struct{}),
		pageToSubscriberCancel: make(map[string]context.CancelFunc),
	}
}

const (
	maxConnectionsPerUser         = 3
	maxSubscriptionsPerConnection = 50
)

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.OpenCh:
			if _, ok := h.userToClients[client.user.Id]; !ok {
				h.userToClients[client.user.Id] = make(map[*Client]struct{})
			}

			if len(h.userToClients[client.user.Id]) >= maxConnectionsPerUser {
				log.Printf("User %s reached max connections (%d)", client.user.Id, maxConnectionsPerUser)
				close(client.Send)
				continue
			}

			h.userToClients[client.user.Id][client] = struct{}{}

		case client := <-h.CloseCh:
			for page := range client.subscribedPages {
				delete(h.pageToClients[page], client)
				if len(h.pageToClients[page]) == 0 {
					if cancel, ok := h.pageToSubscriberCancel[page]; ok {
						cancel()
						delete(h.pageToSubscriberCancel, page)
					}
					delete(h.pageToClients, page)
				}
			}
			delete(h.userToClients[client.user.Id], client)
			if len(h.userToClients[client.user.Id]) == 0 {
				delete(h.userToClients, client.user.Id)
			}

		case sub := <-h.SubscribeCh:
			if len(sub.client.subscribedPages) >= maxSubscriptionsPerConnection {
				log.Printf("Connection by user %s reached max subscriptions (%d)", sub.client.user.Id, maxSubscriptionsPerConnection)
				continue
			}
			if h.pageToClients[sub.pageKey] == nil {
				log.Printf("Subscriber does not exist, creating for key: %s", sub.pageKey)

				ctx, cancel := context.WithCancel(context.Background())
				pageKey := sub.pageKey
				channel := "page:" + pageKey

				err := h.webverseCache.Subscribe(ctx, channel, func(messageBytes []byte) {
					for client := range h.pageToClients[pageKey] {
						client.Send <- messageBytes
					}
				})
				if err != nil {
					log.Printf("Failed to create redis sub for channel %s: %v", channel, err)
					continue
				}

				h.pageToClients[sub.pageKey] = make(map[*Client]struct{})
				h.pageToSubscriberCancel[sub.pageKey] = cancel
			}
			h.pageToClients[sub.pageKey][sub.client] = struct{}{}
			sub.client.subscribedPages[sub.pageKey] = struct{}{}

		case unsub := <-h.UnsubscribeCh:
			delete(h.pageToClients[unsub.pageKey], unsub.client)
			delete(unsub.client.subscribedPages, unsub.pageKey)
			if len(h.pageToClients[unsub.pageKey]) == 0 {
				if cancel, ok := h.pageToSubscriberCancel[unsub.pageKey]; ok {
					cancel()
					delete(h.pageToSubscriberCancel, unsub.pageKey)
				}
				delete(h.pageToClients, unsub.pageKey)
			}

		case userId := <-h.UserDeletedCh:
			if clients, ok := h.userToClients[userId]; ok {
				for client := range clients {
					close(client.Send)
					delete(h.userToClients[userId], client)
				}
				delete(h.userToClients, userId)
			}

		case userKeysUpdatedMsg := <-h.UserKeysUpdatedCh:
			if clients, ok := h.userToClients[userKeysUpdatedMsg.UserId]; ok {
				data := keysUpdatedData{KeyVersion: userKeysUpdatedMsg.KeyVersion, KeysDeleted: userKeysUpdatedMsg.KeysDeleted}
				message := keysUpdatedMessage{Type: "keys_updated", Data: data}
				keysUpdatedBytes, err := json.Marshal(message)
				if err == nil {
					for client := range clients {
						client.Send <- keysUpdatedBytes
						client.updateKeys <- data
					}
				}

			}

		}
	}
}

func (h *Hub) InitSubscriptions(shutdownCtx context.Context) error {
	err := h.webverseCache.Subscribe(shutdownCtx, "user-deleted", func(message []byte) {
		var userDeletedMsg service.UserDeletedMessage
		if err := json.Unmarshal(message, &userDeletedMsg); err == nil {
			h.UserDeletedCh <- userDeletedMsg.UserId
		}
	})
	if err != nil {
		log.Printf("WS hub failed to subscribe to user-deleted: %v", err)
		return err
	}

	err = h.webverseCache.Subscribe(shutdownCtx, "user-keys-updated", func(message []byte) {
		var userKeysUpdatedMsg service.UserKeysUpdatedMessage
		if err := json.Unmarshal(message, &userKeysUpdatedMsg); err == nil {
			h.UserKeysUpdatedCh <- userKeysUpdatedMsg
		} else {
			log.Printf("Failed to unmarshal user-keys-updated message: %v", err)
		}
	})
	if err != nil {
		log.Printf("WS hub failed to subscribe to user-keys-updated: %v", err)
		return err
	}

	return nil
}
