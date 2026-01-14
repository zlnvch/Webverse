package mocks

import (
	"context"

	"github.com/stretchr/testify/mock"
	"github.com/zlnvch/webverse/cache"
)

type MockCache struct {
	mock.Mock
}

func (m *MockCache) Publish(ctx context.Context, channel string, message []byte) error {
	args := m.Called(ctx, channel, message)
	return args.Error(0)
}

func (m *MockCache) Subscribe(ctx context.Context, channel string, handler func(message []byte)) error {
	args := m.Called(ctx, channel, handler)
	return args.Error(0)
}

func (m *MockCache) AddStroke(ctx context.Context, pageKey string, strokeId string, score int64, strokeData []byte) error {
	args := m.Called(ctx, pageKey, strokeId, score, strokeData)
	return args.Error(0)
}

func (m *MockCache) AddStrokesBatch(ctx context.Context, pageKey string, strokes []cache.StrokeCacheItem) error {
	args := m.Called(ctx, pageKey, strokes)
	return args.Error(0)
}

func (m *MockCache) RemoveStroke(ctx context.Context, pageKey string, strokeId string) error {
	args := m.Called(ctx, pageKey, strokeId)
	return args.Error(0)
}

func (m *MockCache) GetStrokes(ctx context.Context, pageKey string) ([][]byte, error) {
	args := m.Called(ctx, pageKey)
	return args.Get(0).([][]byte), args.Error(1)
}

func (m *MockCache) SetPageComplete(ctx context.Context, pageKey string) error {
	args := m.Called(ctx, pageKey)
	return args.Error(0)
}

func (m *MockCache) IsPageComplete(ctx context.Context, pageKey string) (bool, error) {
	args := m.Called(ctx, pageKey)
	return args.Bool(0), args.Error(1)
}

func (m *MockCache) InvalidatePages(ctx context.Context, pageKeys []string) error {
	args := m.Called(ctx, pageKeys)
	return args.Error(0)
}

func (m *MockCache) IncrementUserStrokeCount(ctx context.Context, userId string) (int64, error) {
	args := m.Called(ctx, userId)
	return args.Get(0).(int64), args.Error(1)
}

func (m *MockCache) DecrementUserStrokeCount(ctx context.Context, userId string) error {
	args := m.Called(ctx, userId)
	return args.Error(0)
}

func (m *MockCache) SeedUserStrokeCount(ctx context.Context, userId string, count int) error {
	args := m.Called(ctx, userId, count)
	return args.Error(0)
}

func (m *MockCache) GetUserStrokeCount(ctx context.Context, userId string) (int, error) {
	args := m.Called(ctx, userId)
	return args.Int(0), args.Error(1)
}

func (m *MockCache) GetPageStrokeCountFromZCard(ctx context.Context, pageKey string) (int64, error) {
	args := m.Called(ctx, pageKey)
	return args.Get(0).(int64), args.Error(1)
}
