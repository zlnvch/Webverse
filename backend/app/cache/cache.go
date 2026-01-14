package cache

import "context"

type StrokeCacheItem struct {
	StrokeId string
	Score    int64
	Data     []byte
}

type WebverseCache interface {
	Publish(ctx context.Context, channel string, message []byte) error
	Subscribe(ctx context.Context, channel string, handler func(message []byte)) error

	AddStroke(ctx context.Context, pageKey string, strokeId string, score int64, strokeData []byte) error
	AddStrokesBatch(ctx context.Context, pageKey string, strokes []StrokeCacheItem) error
	RemoveStroke(ctx context.Context, pageKey string, strokeId string) error
	GetStrokes(ctx context.Context, pageKey string) ([][]byte, error)
	GetPageStrokeCountFromZCard(ctx context.Context, pageKey string) (int64, error)

	SetPageComplete(ctx context.Context, pageKey string) error
	IsPageComplete(ctx context.Context, pageKey string) (bool, error)
	InvalidatePages(ctx context.Context, pageKeys []string) error

	IncrementUserStrokeCount(ctx context.Context, userId string) (int64, error)
	DecrementUserStrokeCount(ctx context.Context, userId string) error
	SeedUserStrokeCount(ctx context.Context, userId string, count int) error
	GetUserStrokeCount(ctx context.Context, userId string) (int, error)
}
