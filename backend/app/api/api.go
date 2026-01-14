package api

import (
	"context"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/zlnvch/webverse/api/rest"
	"github.com/zlnvch/webverse/api/ws"
	"github.com/zlnvch/webverse/cache"
	"github.com/zlnvch/webverse/mq"
	"github.com/zlnvch/webverse/service"
	"github.com/zlnvch/webverse/store"
	"github.com/zlnvch/webverse/worker"
	"golang.org/x/oauth2"
)

type WebverseAPI struct {
	restHandler *rest.Handler
	wsHandler   *ws.Handler
	wsUpgrader  websocket.Upgrader
	shutdownCtx context.Context
}

func NewWebverseAPI(
	webverseStore store.WebverseStore,
	deleteUserStrokesQueue mq.MessageQueue,
	webverseCache cache.WebverseCache,
	oauthConfigs map[string]*oauth2.Config,
	jwtSecret []byte,
	shutdownCtx context.Context,
) (*WebverseAPI, error) {
	wsHub := ws.NewHub(webverseCache)
	err := wsHub.InitSubscriptions(shutdownCtx)
	if err != nil {
		log.Printf("Failed to start WS Hub subscriptions service: %v", err)
		return &WebverseAPI{}, err
	}
	go wsHub.Run()

	counterBatcher := worker.NewCounterBatcher(webverseStore, 60000)
	go counterBatcher.Run(shutdownCtx)

	strokeBatcher := worker.NewStrokeBatcher(webverseStore, 500, counterBatcher)
	go strokeBatcher.Run(shutdownCtx)

	mqConsumer := worker.NewMQConsumer(deleteUserStrokesQueue, webverseStore, webverseCache, counterBatcher)
	go mqConsumer.Run(shutdownCtx)

	svc, err := service.NewService(
		webverseStore,
		webverseCache,
		deleteUserStrokesQueue,
		strokeBatcher,
		counterBatcher,
		oauthConfigs,
		jwtSecret,
	)
	if err != nil {
		log.Printf("Failed to create service: %v", err)
		return &WebverseAPI{}, err
	}

	restHandler := rest.NewHandler(svc)
	wsHandler := ws.NewHandler(svc, wsHub)

	return &WebverseAPI{
		restHandler: restHandler,
		wsHandler:   wsHandler,
		shutdownCtx: shutdownCtx,
	}, nil
}

func (webverseAPI *WebverseAPI) RegisterRoutes(mux *http.ServeMux, requiredOrigin string) {
	// Health check endpoint (no auth required)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	mux.HandleFunc("/login", webverseAPI.restHandler.HandleLogin)
	mux.HandleFunc("/me", webverseAPI.restHandler.HandleMe)
	mux.HandleFunc("/me/encryption-keys", webverseAPI.restHandler.HandleEncryptionKeys)

	wsUpgrader := webverseAPI.wsHandler.NewWsUpgrader(requiredOrigin)
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		webverseAPI.wsHandler.ServeWS(wsUpgrader, w, r, webverseAPI.shutdownCtx)
	})
}
