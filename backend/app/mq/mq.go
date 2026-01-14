package mq

import "context"

type MessageQueue interface {
	Send(ctx context.Context, body string) error
	Receive(ctx context.Context, visibilityTimeout int32) (*Message, error)
	Delete(ctx context.Context, msg *Message) error
}

type Message struct {
	Id   string
	Body string
}
