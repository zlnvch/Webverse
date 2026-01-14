package mocks

import (
	"context"

	"github.com/stretchr/testify/mock"
	"github.com/zlnvch/webverse/mq"
)

type MockMQ struct {
	mock.Mock
}

func (m *MockMQ) Send(ctx context.Context, body string) error {
	args := m.Called(ctx, body)
	return args.Error(0)
}

func (m *MockMQ) Receive(ctx context.Context, visibilityTimeout int32) (*mq.Message, error) {
	args := m.Called(ctx, visibilityTimeout)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*mq.Message), args.Error(1)
}

func (m *MockMQ) Delete(ctx context.Context, msg *mq.Message) error {
	args := m.Called(ctx, msg)
	return args.Error(0)
}
