package mocks

import (
	"context"

	"github.com/stretchr/testify/mock"
	"github.com/zlnvch/webverse/models"
)

type MockStore struct {
	mock.Mock
}

func (m *MockStore) CreateUser(ctx context.Context, user models.User) (models.User, error) {
	args := m.Called(ctx, user)
	return args.Get(0).(models.User), args.Error(1)
}

func (m *MockStore) GetUser(ctx context.Context, provider string, providerId string) (models.User, error) {
	args := m.Called(ctx, provider, providerId)
	return args.Get(0).(models.User), args.Error(1)
}

func (m *MockStore) GetStrokeRecords(ctx context.Context, pageKey string) ([]models.Stroke, error) {
	args := m.Called(ctx, pageKey)
	return args.Get(0).([]models.Stroke), args.Error(1)
}

func (m *MockStore) WriteStrokeBatch(ctx context.Context, strokes []models.StrokeRecord) ([]models.StrokeRecord, error) {
	args := m.Called(ctx, strokes)
	return args.Get(0).([]models.StrokeRecord), args.Error(1)
}

func (m *MockStore) DeleteStroke(ctx context.Context, pageKey string, strokeId string, userId string) error {
	args := m.Called(ctx, pageKey, strokeId, userId)
	return args.Error(0)
}

func (m *MockStore) DeleteUser(ctx context.Context, provider string, providerId string) error {
	args := m.Called(ctx, provider, providerId)
	return args.Error(0)
}

func (m *MockStore) DeleteUserStrokes(ctx context.Context, userId string, layer string) error {
	args := m.Called(ctx, userId, layer)
	return args.Error(0)
}

func (m *MockStore) GetUserPages(ctx context.Context, userId string) ([]string, error) {
	args := m.Called(ctx, userId)
	return args.Get(0).([]string), args.Error(1)
}

func (m *MockStore) GetUserStrokeCount(ctx context.Context, userId string, layer string) (int, error) {
	args := m.Called(ctx, userId, layer)
	return args.Int(0), args.Error(1)
}

func (m *MockStore) SetUserEncryptionKeys(ctx context.Context, user models.User, incrementKeyVersion bool) (int, error) {
	args := m.Called(ctx, user, incrementKeyVersion)
	return args.Int(0), args.Error(1)
}

func (m *MockStore) IncrementUserStrokeCount(ctx context.Context, provider string, providerId string, count int) error {
	args := m.Called(ctx, provider, providerId, count)
	return args.Error(0)
}
