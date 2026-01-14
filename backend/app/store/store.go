package store

import (
	"context"
	"errors"

	"github.com/zlnvch/webverse/models"
)

type WebverseStore interface {
	CreateUser(ctx context.Context, user models.User) (models.User, error)
	GetUser(ctx context.Context, provider string, providerId string) (models.User, error)
	GetStrokeRecords(ctx context.Context, pageKey string) ([]models.Stroke, error)
	WriteStrokeBatch(ctx context.Context, strokes []models.StrokeRecord) ([]models.StrokeRecord, error)
	DeleteStroke(ctx context.Context, pageKey string, strokeId string, userId string) error
	DeleteUser(ctx context.Context, provider string, providerId string) error
	DeleteUserStrokes(ctx context.Context, userId string, layer string) error
	GetUserPages(ctx context.Context, userId string) ([]string, error)
	GetUserStrokeCount(ctx context.Context, userId string, layer string) (int, error)
	SetUserEncryptionKeys(ctx context.Context, user models.User, incrementKeyVersion bool) (int, error)

	IncrementUserStrokeCount(ctx context.Context, provider string, providerId string, count int) error
}

// Custom error types for clarity
var (
	ErrItemNotFound    = errors.New("item does not exist")
	ErrConditionFailed = errors.New("condition not met")
)
