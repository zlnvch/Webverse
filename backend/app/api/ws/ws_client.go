package ws

import (
	"context"
	"log"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zlnvch/webverse/models"
	"golang.org/x/time/rate"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 1024 * 16

	// Rate limiting: 20 messages per second with a burst of 30
	messagesPerSecond = 20
	burstLimit        = 30
)

type MessageHandler func(client *Client, messageType int, messageBytes []byte)

func NewClient(hub *Hub, conn *websocket.Conn, user models.User, handler MessageHandler) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{
		hub:             hub,
		conn:            conn,
		user:            user,
		handler:         handler,
		subscribedPages: make(map[string]struct{}),
		Send:            make(chan []byte, 128),
		updateKeys:      make(chan keysUpdatedData, 2),
		ctx:             ctx,
		cancel:          cancel,
		limiter:         rate.NewLimiter(rate.Limit(messagesPerSecond), burstLimit),
	}
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	hub             *Hub
	conn            *websocket.Conn
	user            models.User
	handler         MessageHandler
	subscribedPages map[string]struct{}
	Send            chan []byte // Buffered channel of outbound messages.
	updateKeys      chan keysUpdatedData
	ctx             context.Context
	cancel          context.CancelFunc
	limiter         *rate.Limiter
}

func (c *Client) ReadPump() {
	defer func() {
		c.hub.CloseCh <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	for {
		messageType, messageBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WS close error: %v", err)
			}
			break
		}

		if !c.limiter.Allow() {
			log.Printf("Closing connection for user %s: message rate limit exceeded", c.user.Id)
			break
		}

		c.handler(c, messageType, messageBytes)
	}
}

func (c *Client) WritePump(shutdownCtx context.Context) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
		c.cancel()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("WS send error: %v", err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-shutdownCtx.Done():
			c.conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseGoingAway, "Websocket service shutting down"),
			)
			c.conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}
	}
}

func (c *Client) StatePump() {
	for {
		select {
		case keysUpdatedData := <-c.updateKeys:
			if keysUpdatedData.KeyVersion >= c.user.KeyVersion {
				c.user.KeyVersion = keysUpdatedData.KeyVersion
				if keysUpdatedData.KeysDeleted {
					c.user.EncryptedDEK1 = ""
					c.user.NonceDEK1 = ""
					c.user.EncryptedDEK2 = ""
					c.user.NonceDEK2 = ""
				}
			}

		case <-c.ctx.Done():
			return
		}
	}
}
