package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/zlnvch/webverse/models"
	"github.com/zlnvch/webverse/service"
)

type Handler struct {
	Service *service.Service
	Hub     *Hub
}

func NewHandler(svc *service.Service, hub *Hub) *Handler {
	return &Handler{
		Service: svc,
		Hub:     hub,
	}
}

func (h *Handler) NewWsUpgrader(requiredOrigin string) websocket.Upgrader {
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			return origin == requiredOrigin
		},
		Subprotocols: []string{"webverse-v1"},
	}
}

// ServeWS handles websocket requests from the peer.
func (h *Handler) ServeWS(wsUpgrader websocket.Upgrader, w http.ResponseWriter, r *http.Request, shutdownCtx context.Context) {
	protocols := r.Header.Get("Sec-WebSocket-Protocol")
	protocolsSplit := strings.Split(protocols, ",")

	if len(protocolsSplit) != 2 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	token := strings.TrimSpace(protocolsSplit[1])

	user, authErr := h.Service.AuthenticateToken(r.Context(), token)

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade ws connection: %v", err)
		return
	}

	// Must upgrade the connection in order to be able to send custom close message
	if authErr != nil {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "Unauthenticated"),
		)
		conn.Close()
		return
	}

	client := NewClient(h.Hub, conn, user, h.HandleWsMessage)

	// Seed User Stroke Quota in Redis
	h.Service.Cache.SeedUserStrokeCount(context.Background(), user.Id, user.StrokeCount)

	h.Hub.OpenCh <- client

	// Start pumps
	go client.ReadPump()
	go client.WritePump(shutdownCtx)
	go client.StatePump()

	// Send the key information if it exists
	// Allows the frontend to ensure they have the correct key version
	// in case they updated their keys in a separate connection
	if user.KeyVersion > 0 {
		keysDeleted := false
		if user.SaltKEK == "" {
			keysDeleted = true
		}
		data := keysUpdatedData{
			KeyVersion:  user.KeyVersion,
			KeysDeleted: keysDeleted,
		}
		msg := keysUpdatedMessage{
			Type: "keys_updated",
			Data: data,
		}
		if msgBytes, err := json.Marshal(msg); err == nil {
			client.Send <- msgBytes
		} else {
			log.Printf("Failed to marshal initial keys updated message: %v", err)
		}
	}
}

// Websocket message structs
type message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type pageMessage struct {
	PageKey string           `json:"pageKey"`
	Layer   models.LayerType `json:"layer"`
	LayerId string           `json:"layerId"`
}

type drawMessage struct {
	Stroke       models.Stroke    `json:"stroke"`
	PageKey      string           `json:"pageKey"`
	UserStrokeId uint32           `json:"userStrokeId"`
	Layer        models.LayerType `json:"layer"`
	LayerId      string           `json:"layerId"`
}

type undoMessage struct {
	PageKey  string           `json:"pageKey"`
	Layer    models.LayerType `json:"layer"`
	LayerId  string           `json:"layerId"`
	StrokeId string           `json:"strokeId"`
}

type responseMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

func (h *Handler) HandleWsMessage(client *Client, messageType int, messageBytes []byte) {
	var msg message
	if err := json.Unmarshal(messageBytes, &msg); err != nil {
		log.Printf("Invalid JSON: %v", err)
		return
	}

	var resp responseMessage

	switch msg.Type {
	case "load":
		var pageMsg pageMessage
		if err := json.Unmarshal(msg.Data, &pageMsg); err != nil {
			log.Printf("Invalid load data: %v", err)
			return
		}
		resp = h.handleLoad(client, pageMsg)

	case "subscribe":
		var pageMsg pageMessage
		if err := json.Unmarshal(msg.Data, &pageMsg); err != nil {
			log.Printf("Invalid subscribe data: %v", err)
			return
		}
		resp = h.handleSubscribe(client, pageMsg)

	case "unsubscribe":
		var pageMsg pageMessage
		if err := json.Unmarshal(msg.Data, &pageMsg); err != nil {
			log.Printf("Invalid unsubscribe data: %v", err)
			return
		}
		resp = h.handleUnsubscribe(client, pageMsg)

	case "draw":
		var drawMsg drawMessage
		if err := json.Unmarshal(msg.Data, &drawMsg); err != nil {
			log.Printf("Invalid draw data: %v", err)
			return
		}
		resp = h.handleDraw(client, drawMsg, false)

	case "undo":
		var undoMsg undoMessage
		if err := json.Unmarshal(msg.Data, &undoMsg); err != nil {
			log.Printf("Invalid undo data: %v", err)
			return
		}
		resp = h.handleUndo(client, undoMsg)

	case "redo":
		var redoMsg drawMessage
		if err := json.Unmarshal(msg.Data, &redoMsg); err != nil {
			log.Printf("Invalid redo data: %v", err)
			return
		}
		resp = h.handleDraw(client, redoMsg, true)

	default:
		log.Printf("Unknown message type: %v", msg.Type)
	}

	if resp.Type != "" {
		respBytes, err := json.Marshal(resp)
		if err != nil {
			log.Printf("Error marshaling response JSON: %v", err)
			return
		}
		client.Send <- respBytes
	}
}

func (h *Handler) handleLoad(client *Client, pageMsg pageMessage) responseMessage {
	resp := responseMessage{
		Type: "load_response",
	}

	strokes, err := h.Service.LoadPage(context.Background(), pageMsg.PageKey, pageMsg.Layer)
	if err != nil {
		log.Printf("LoadPage failed: %v", err)
		resp.Data = map[string]any{"success": false, "pageKey": pageMsg.PageKey, "layer": pageMsg.Layer, "layerId": pageMsg.LayerId, "strokes": []models.Stroke{}}
		return resp
	}

	resp.Data = map[string]any{"success": true, "pageKey": pageMsg.PageKey, "layer": pageMsg.Layer, "layerId": pageMsg.LayerId, "strokes": strokes}
	return resp
}

func (h *Handler) handleSubscribe(client *Client, pageMsg pageMessage) responseMessage {
	resp := responseMessage{
		Type: "subscribe_response",
	}

	if err := service.ValidatePageKey(pageMsg.PageKey, pageMsg.Layer == models.LayerPrivate); err != nil {
		log.Printf("Subscribe page key validation failed: %v", err)
		resp.Data = map[string]any{"success": false, "pageKey": pageMsg.PageKey, "layer": pageMsg.Layer, "layerId": pageMsg.LayerId}
		return resp
	}

	sub := subscription{client: client, pageKey: pageMsg.PageKey}
	h.Hub.SubscribeCh <- sub
	resp.Data = map[string]any{"success": true, "pageKey": pageMsg.PageKey, "layer": pageMsg.Layer, "layerId": pageMsg.LayerId}

	return resp
}

func (h *Handler) handleUnsubscribe(client *Client, pageMsg pageMessage) responseMessage {
	resp := responseMessage{
		Type: "unsubscribe_response",
	}

	if err := service.ValidatePageKey(pageMsg.PageKey, pageMsg.Layer == models.LayerPrivate); err != nil {
		log.Printf("Unsubscribe page key validation failed: %v", err)
		resp.Data = map[string]any{"success": false, "pageKey": pageMsg.PageKey, "layer": pageMsg.Layer, "layerId": pageMsg.LayerId}
		return resp
	}

	sub := subscription{client: client, pageKey: pageMsg.PageKey}
	h.Hub.UnsubscribeCh <- sub
	resp.Data = map[string]any{"success": true, "pageKey": pageMsg.PageKey, "layer": pageMsg.Layer, "layerId": pageMsg.LayerId}

	return resp
}

func (h *Handler) handleDraw(client *Client, drawMsg drawMessage, isRedo bool) responseMessage {
	resp := responseMessage{}
	if isRedo {
		resp.Type = "redo_response"
	} else {
		resp.Type = "draw_response"
	}

	strokeId, err := h.Service.DrawStroke(context.Background(), service.DrawParams{
		User:         client.user,
		PageKey:      drawMsg.PageKey,
		Layer:        drawMsg.Layer,
		LayerId:      drawMsg.LayerId,
		Stroke:       drawMsg.Stroke,
		UserStrokeId: drawMsg.UserStrokeId,
		IsRedo:       isRedo,
	})

	if err != nil {
		log.Printf("DrawStroke failed: %v", err)
		resp.Data = map[string]any{
			"success":      false,
			"error":        err.Error(),
			"pageKey":      drawMsg.PageKey,
			"layer":        drawMsg.Layer,
			"layerId":      drawMsg.LayerId,
			"userStrokeId": drawMsg.UserStrokeId,
		}
		return resp
	}

	resp.Data = map[string]any{
		"success":      true,
		"pageKey":      drawMsg.PageKey,
		"layer":        drawMsg.Layer,
		"layerId":      drawMsg.LayerId,
		"userStrokeId": drawMsg.UserStrokeId,
		"strokeId":     strokeId,
	}

	return resp
}

func (h *Handler) handleUndo(client *Client, undoMsg undoMessage) responseMessage {
	resp := responseMessage{
		Type: "undo_response",
	}

	err := h.Service.UndoStroke(context.Background(), service.UndoParams{
		User:     client.user,
		PageKey:  undoMsg.PageKey,
		Layer:    undoMsg.Layer,
		LayerId:  undoMsg.LayerId,
		StrokeId: undoMsg.StrokeId,
	})

	if err != nil {
		log.Printf("UndoStroke failed: %v", err)
		resp.Data = map[string]any{
			"success":  false,
			"error":    err.Error(),
			"pageKey":  undoMsg.PageKey,
			"layer":    undoMsg.Layer,
			"layerId":  undoMsg.LayerId,
			"strokeId": undoMsg.StrokeId,
		}
		return resp
	}

	resp.Data = map[string]any{
		"success":  true,
		"pageKey":  undoMsg.PageKey,
		"layer":    undoMsg.Layer,
		"layerId":  undoMsg.LayerId,
		"strokeId": undoMsg.StrokeId,
	}

	return resp
}
