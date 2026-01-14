package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/zlnvch/webverse/models"
)

func TestLoadPage_CacheComplete(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	// 1. Setup Redis Strokes
	stroke := models.Stroke{Id: "018e38d7-0000-7000-8000-000000000000", Content: []byte("data")}
	strokeBytes, _ := json.Marshal(stroke)

	// Expect Cache GetStrokes
	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{strokeBytes}, nil)

	// Expect IsPageComplete -> True
	mockCache.On("IsPageComplete", ctx, pageKey).Return(true, nil)

	// Cache is complete, so Store should NOT be called
	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err)
	assert.Len(t, strokes, 1)
	assert.Equal(t, stroke.Id, strokes[0].Id)

	mockStore.AssertNotCalled(t, "GetStrokeRecords", mock.Anything, mock.Anything)
}

func TestLoadPage_CacheInvalidStroke(t *testing.T) {
	svc, _, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	// 1. Cache returns complete flag
	mockCache.On("IsPageComplete", ctx, pageKey).Return(true, nil)

	// 2. Cache returns one valid stroke and one invalid JSON
	stroke := models.Stroke{Id: "018e38d7-0000-7000-8000-000000000000", Content: []byte("data")}
	strokeBytes, _ := json.Marshal(stroke)
	invalidJSON := []byte("{invalid json}")

	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{strokeBytes, invalidJSON}, nil)

	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err)
	assert.Len(t, strokes, 1) // Only the valid stroke
	assert.Equal(t, stroke.Id, strokes[0].Id)
}

func TestLoadPage_CacheIncomplete_Merge(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	// UUIDv7 IDs are time-ordered; lexical string comparison matches time ordering
	idOld := "00000000-0000-7000-8000-000000000001" // Older stroke
	idNew := "ffffffff-ffff-7000-8000-000000000002" // Newer stroke

	s1 := models.Stroke{Id: idOld, Content: []byte("old")}
	s2 := models.Stroke{Id: idNew, Content: []byte("new")}

	s2Bytes, _ := json.Marshal(s2)

	// 1. Cache returns Newer stroke
	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{s2Bytes}, nil)

	// 2. IsPageComplete -> False
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)

	// 3. Store returns Older stroke
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{s1}, nil)

	// 4. Expect Backfill to Redis (s1 should be added)
	// Seed Count
	mockCache.On("SetPageStrokeCount", ctx, pageKey, 2).Return(nil)
	// Add Batch
	mockCache.On("AddStrokesBatch", ctx, pageKey, mock.Anything).Return(nil)

	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err)
	assert.Len(t, strokes, 2)

	// Should be sorted Old -> New
	assert.Equal(t, idOld, strokes[0].Id)
	assert.Equal(t, idNew, strokes[1].Id)
}

func TestLoadPage_MergeWithDuplicates(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	// Same stroke in both DB and Redis
	id := "00000000-0000-7000-8000-000000000001"
	s1 := models.Stroke{Id: id, Content: []byte("data")}
	s2Bytes, _ := json.Marshal(s1)

	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{s2Bytes}, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{s1}, nil)

	mockCache.On("SetPageStrokeCount", ctx, pageKey, 1).Return(nil)
	mockCache.On("AddStrokesBatch", ctx, pageKey, mock.Anything).Return(nil)

	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err)
	assert.Len(t, strokes, 1) // Only one copy
	assert.Equal(t, id, strokes[0].Id)
}

func TestLoadPage_MergeOnlyDBStrokes(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	id1 := "00000000-0000-7000-8000-000000000001"
	id2 := "00000000-0000-7000-8000-000000000002"

	s1 := models.Stroke{Id: id1, Content: []byte("data1")}
	s2 := models.Stroke{Id: id2, Content: []byte("data2")}

	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{}, nil) // No cache strokes
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{s1, s2}, nil)

	mockCache.On("SetPageStrokeCount", ctx, pageKey, 2).Return(nil)
	mockCache.On("AddStrokesBatch", ctx, pageKey, mock.Anything).Return(nil)

	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err)
	assert.Len(t, strokes, 2)
}

func TestLoadPage_MergeOnlyRedisStrokes(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	id := "00000000-0000-7000-8000-000000000001"
	s := models.Stroke{Id: id, Content: []byte("data")}
	sBytes, _ := json.Marshal(s)

	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{sBytes}, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{}, nil) // No DB strokes

	mockCache.On("SetPageStrokeCount", ctx, pageKey, 1).Return(nil)
	mockCache.On("AddStrokesBatch", ctx, pageKey, mock.Anything).Return(nil)
	mockCache.On("SetPageComplete", ctx, pageKey).Return(nil)

	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err)
	assert.Len(t, strokes, 1)
}

func TestLoadPage_TruncatesLargeResult(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	// Generate 1200 unique strokes
	dbStrokes := make([]models.Stroke, 600)
	redisStrokes := make([]models.Stroke, 600)

	for i := 0; i < 600; i++ {
		// Create unique IDs with different suffixes
		dbId := fmt.Sprintf("%012x-0000-7000-8000-%012x", i, i)
		redisId := fmt.Sprintf("%012x-0000-7000-8000-%012x", i+600, i+600)
		dbStrokes[i] = models.Stroke{Id: dbId, Content: []byte("data")}
		redisStrokes[i] = models.Stroke{Id: redisId, Content: []byte("data")}
	}

	redisBytes := make([][]byte, 600)
	for i, s := range redisStrokes {
		b, _ := json.Marshal(s)
		redisBytes[i] = b
	}

	mockCache.On("GetStrokes", ctx, pageKey).Return(redisBytes, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return(dbStrokes, nil)

	mockCache.On("SetPageStrokeCount", ctx, pageKey, mock.AnythingOfType("int")).Return(nil)
	mockCache.On("AddStrokesBatch", ctx, pageKey, mock.Anything).Return(nil)

	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err)
	assert.Len(t, strokes, 1100) // Truncated to 1100
}

func TestLoadPage_EmptyBothSources(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{}, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{}, nil)

	mockCache.On("SetPageStrokeCount", ctx, pageKey, 0).Return(nil)
	// AddStrokesBatch should NOT be called with empty slice
	mockCache.On("SetPageComplete", ctx, pageKey).Return(nil)

	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err)
	assert.Len(t, strokes, 0)

	mockCache.AssertNotCalled(t, "AddStrokesBatch", mock.Anything, mock.Anything, mock.Anything)
}

func TestLoadPage_StoreError(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{}, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{}, errors.New("db connection failed"))

	_, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "db connection failed")
}

func TestLoadPage_CacheGetStrokesError(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	pageKey := "example.com"

	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{}, errors.New("cache error"))
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{}, nil)

	mockCache.On("SetPageStrokeCount", ctx, pageKey, 0).Return(nil)
	mockCache.On("SetPageComplete", ctx, pageKey).Return(nil)

	strokes, err := svc.LoadPage(ctx, pageKey, models.LayerPublic)
	assert.NoError(t, err) // Should fallback to DB
	assert.Len(t, strokes, 0)
}

func TestLoadPage_InvalidKey(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()

	_, err := svc.LoadPage(ctx, "invalid key", models.LayerPublic)
	assert.Error(t, err)
}

func TestLoadPage_PrivateLayer_InvalidKey(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()

	_, err := svc.LoadPage(ctx, "not-a-valid-base64-key", models.LayerPrivate)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid private page key")
}

func TestLoadPage_PrivateLayer_ValidKey(t *testing.T) {
	svc, _, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()

	// Valid private key (base64 of 32 bytes)
	privateKey := "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="

	stroke := models.Stroke{Id: "018e38d7-0000-7000-8000-000000000000", Content: []byte("data")}
	strokeBytes, _ := json.Marshal(stroke)

	mockCache.On("GetStrokes", ctx, privateKey).Return([][]byte{strokeBytes}, nil)
	mockCache.On("IsPageComplete", ctx, privateKey).Return(true, nil)

	strokes, err := svc.LoadPage(ctx, privateKey, models.LayerPrivate)
	assert.NoError(t, err)
	assert.Len(t, strokes, 1)
}
