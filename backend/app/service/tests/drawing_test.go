package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	cachemocks "github.com/zlnvch/webverse/cache/mocks"
	"github.com/zlnvch/webverse/models"
	mqmocks "github.com/zlnvch/webverse/mq/mocks"
	"github.com/zlnvch/webverse/service"
	"github.com/zlnvch/webverse/store"
	storemocks "github.com/zlnvch/webverse/store/mocks"
	"github.com/zlnvch/webverse/worker"
)

// Helper to setup the service with mocks
func setupService(t *testing.T) (*service.Service, *storemocks.MockStore, *cachemocks.MockCache, *mqmocks.MockMQ, *worker.StrokeBatcher, *worker.CounterBatcher) {
	mockStore := new(storemocks.MockStore)
	mockCache := new(cachemocks.MockCache)
	mockMQ := new(mqmocks.MockMQ)

	// Real batchers are used; tests verify items are pushed to their channels
	counterBatcher := worker.NewCounterBatcher(mockStore, 1000)
	strokeBatcher := worker.NewStrokeBatcher(mockStore, 1000, counterBatcher)

	svc, err := service.NewService(
		mockStore,
		mockCache,
		mockMQ,
		strokeBatcher,
		counterBatcher,
		nil,
		[]byte("secret"),
	)
	assert.NoError(t, err)

	return svc, mockStore, mockCache, mockMQ, strokeBatcher, counterBatcher
}

// Helper that creates a channel and wraps a mock call to signal when it's called
func wrapMockWithSignal(call *mock.Call) chan struct{} {
	done := make(chan struct{})
	call.Run(func(args mock.Arguments) {
		close(done)
	})
	return done
}

func TestDrawStroke_Success(t *testing.T) {
	svc, _, mockCache, _, strokeBatcher, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:          "user1",
		Provider:    "google",
		ProviderId:  "123",
		StrokeCount: 10,
	}
	pageKey := "example.com"

	// Valid stroke content (black pixel)
	content := []byte(`{"tool":0,"color":"#000000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`)

	params := service.DrawParams{
		User:    user,
		PageKey: pageKey,
		Layer:   models.LayerPublic,
		LayerId: "public",
		Stroke: models.Stroke{
			Content: content,
		},
	}

	// Mocks expectation for Quota check
	mockCache.On("GetUserStrokeCount", ctx, user.Id).Return(10, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(true, nil)
	mockCache.On("GetPageStrokeCountFromZCard", ctx, pageKey).Return(int64(100), nil)

	// Mocks expectation for Async side effects - use channels for synchronization
	incrementUserDone := wrapMockWithSignal(mockCache.On("IncrementUserStrokeCount", mock.Anything, user.Id).Return(int64(11), nil))
	addStrokeDone := wrapMockWithSignal(mockCache.On("AddStroke", mock.Anything, pageKey, mock.Anything, mock.Anything, mock.Anything).Return(nil))
	publishDone := wrapMockWithSignal(mockCache.On("Publish", mock.Anything, "page:"+pageKey, mock.Anything).Return(nil))

	strokeId, err := svc.DrawStroke(ctx, params)

	assert.NoError(t, err)
	assert.NotEmpty(t, strokeId)

	// Verify stroke batcher received item
	select {
	case item := <-strokeBatcher.WriteCh:
		assert.Equal(t, pageKey, item.Record.PageKey)
		assert.Equal(t, strokeId, item.Record.Stroke.Id)
		assert.Equal(t, user.Id, item.Record.Stroke.UserId)
	case <-time.After(100 * time.Millisecond):
		assert.Fail(t, "timed out waiting for stroke batcher")
	}

	// Wait for all async operations to complete
	select {
	case <-incrementUserDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for IncrementUserStrokeCount")
	}

	select {
	case <-addStrokeDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for AddStroke")
	}

	select {
	case <-publishDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for Publish")
	}
}

func TestDrawStroke_AsyncAddStrokeFails(t *testing.T) {
	svc, _, mockCache, _, strokeBatcher, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:          "user1",
		Provider:    "google",
		ProviderId:  "123",
		StrokeCount: 10,
	}
	pageKey := "example.com"
	content := []byte(`{"tool":0,"color":"#000000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`)

	params := service.DrawParams{
		User:    user,
		PageKey: pageKey,
		Layer:   models.LayerPublic,
		LayerId: "public",
		Stroke:  models.Stroke{Content: content},
	}

	mockCache.On("GetUserStrokeCount", ctx, user.Id).Return(10, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(true, nil)
	mockCache.On("GetPageStrokeCountFromZCard", ctx, pageKey).Return(int64(100), nil)

	// AddStroke fails in async goroutine
	mockCache.On("IncrementUserStrokeCount", mock.Anything, user.Id).Return(int64(11), nil)
	mockCache.On("AddStroke", mock.Anything, pageKey, mock.Anything, mock.Anything, mock.Anything).Return(errors.New("redis connection failed"))
	mockCache.On("Publish", mock.Anything, "page:"+pageKey, mock.Anything).Return(nil)

	strokeId, err := svc.DrawStroke(ctx, params)

	// Should still succeed (async errors don't affect return)
	assert.NoError(t, err)
	assert.NotEmpty(t, strokeId)

	// Verify stroke batcher still received item
	select {
	case <-strokeBatcher.WriteCh:
		// Expected
	case <-time.After(100 * time.Millisecond):
		assert.Fail(t, "timed out waiting for stroke batcher")
	}
}

func TestDrawStroke_AsyncPublishFails(t *testing.T) {
	svc, _, mockCache, _, strokeBatcher, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:          "user1",
		Provider:    "google",
		ProviderId:  "123",
		StrokeCount: 10,
	}
	pageKey := "example.com"
	content := []byte(`{"tool":0,"color":"#000000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`)

	params := service.DrawParams{
		User:    user,
		PageKey: pageKey,
		Layer:   models.LayerPublic,
		LayerId: "public",
		Stroke:  models.Stroke{Content: content},
	}

	mockCache.On("GetUserStrokeCount", ctx, user.Id).Return(10, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(true, nil)
	mockCache.On("GetPageStrokeCountFromZCard", ctx, pageKey).Return(int64(100), nil)

	// Publish fails in async goroutine
	mockCache.On("IncrementUserStrokeCount", mock.Anything, user.Id).Return(int64(11), nil)
	mockCache.On("AddStroke", mock.Anything, pageKey, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	mockCache.On("Publish", mock.Anything, "page:"+pageKey, mock.Anything).Return(errors.New("pubsub failed"))

	strokeId, err := svc.DrawStroke(ctx, params)

	// Should still succeed (async errors don't affect return)
	assert.NoError(t, err)
	assert.NotEmpty(t, strokeId)

	// Verify stroke batcher still received item
	select {
	case <-strokeBatcher.WriteCh:
		// Expected
	case <-time.After(100 * time.Millisecond):
		assert.Fail(t, "timed out waiting for stroke batcher")
	}
}

func TestDrawStroke_QuotaExceeded_User(t *testing.T) {
	svc, _, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "user1", StrokeCount: 100000} // Max strokes
	params := service.DrawParams{
		User:    user,
		PageKey: "example.com",
		Layer:   models.LayerPublic,
		Stroke:  models.Stroke{Content: []byte(`{"tool":0,"color":"#000000","width":1,"startX":0,"startY":0,"dx":[],"dy":[]}`)},
	}

	mockCache.On("GetUserStrokeCount", ctx, user.Id).Return(100000, nil)

	_, err := svc.DrawStroke(ctx, params)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "user stroke quota exceeded")

	// Verify async operations were NOT called
	mockCache.AssertNotCalled(t, "IncrementUserStrokeCount", mock.Anything, mock.Anything)
	mockCache.AssertNotCalled(t, "AddStroke", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestDrawStroke_QuotaExceeded_User_CacheMiss(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "user1", Provider: "google", ProviderId: "123"}
	pageKey := "example.com"
	params := service.DrawParams{
		User:    user,
		PageKey: pageKey,
		Layer:   models.LayerPublic,
		Stroke:  models.Stroke{Content: []byte(`{"tool":0,"color":"#000000","width":1,"startX":0,"startY":0,"dx":[],"dy":[]}`)},
	}

	// 1. User cache miss (-1)
	mockCache.On("GetUserStrokeCount", ctx, user.Id).Return(-1, errors.New("cache miss"))

	// 2. Store returns user OVER quota (100000 strokes)
	mockStore.On("GetUser", ctx, user.Provider, user.ProviderId).Return(models.User{
		Id:         user.Id,
		Provider:   user.Provider,
		ProviderId: user.ProviderId,
		StrokeCount: 100000,  // Over maxUserStrokes (100000)
	}, nil)

	// 3. Cache gets seeded with the over-quota count
	mockCache.On("SeedUserStrokeCount", ctx, user.Id, 100000).Return(nil)

	// 4. Page check passes
	mockCache.On("IsPageComplete", ctx, pageKey).Return(true, nil)
	mockCache.On("GetPageStrokeCountFromZCard", ctx, pageKey).Return(int64(100), nil)

	_, err := svc.DrawStroke(ctx, params)

	// Regression test: ensures userStrokeCount is updated after cache miss
	// Previously, userStrokeCount stayed -1, bypassing quota checks
	assert.Error(t, err, "Expected quota exceeded error, but got nil")
	if err != nil {
		assert.Contains(t, err.Error(), "user stroke quota exceeded")
	}
}

func TestDrawStroke_QuotaExceeded_Page_CacheMiss(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "user1", StrokeCount: 10}
	pageKey := "example.com"
	params := service.DrawParams{
		User:    user,
		PageKey: pageKey,
		Layer:   models.LayerPublic,
		Stroke:  models.Stroke{Content: []byte(`{"tool":0,"color":"#000000","width":1,"startX":0,"startY":0,"dx":[],"dy":[]}`)},
	}

	// 1. User check passes
	mockCache.On("GetUserStrokeCount", ctx, user.Id).Return(10, nil)

	// 2. Page check: Page not complete, will load from DB
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)

	// 3. LoadPage will be called, which needs GetStrokes
	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{}, nil)

	// 4. Store returns Max Limit
	mockStore.On("GetPageStrokeCount", ctx, pageKey).Return(1000, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{}, nil)

	// 5. Service should update Cache with completion status
	mockCache.On("SetPageComplete", ctx, pageKey).Return(nil)
	mockCache.On("AddStrokesBatch", ctx, pageKey, mock.Anything).Return(nil)

	// 6. After loading page, service checks count via ZCard
	mockCache.On("GetPageStrokeCountFromZCard", ctx, pageKey).Return(int64(1000), nil)

	_, err := svc.DrawStroke(ctx, params)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "page stroke quota exceeded")

	// Verify async operations were NOT called
	mockCache.AssertNotCalled(t, "IncrementUserStrokeCount", mock.Anything, mock.Anything)
}

func TestDrawStroke_PrivateLayer_KeyMismatch(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()

	// User has KeyVersion 5
	user := models.User{Id: "user1", KeyVersion: 5}

	// Valid private key (base64 of 32 bytes)
	privateKey := "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="

	params := service.DrawParams{
		User:    user,
		PageKey: privateKey,
		Layer:   models.LayerPrivate,
		LayerId: "4", // Mismatch! Should be "5"
		Stroke:  models.Stroke{},
	}

	_, err := svc.DrawStroke(ctx, params)
	assert.Error(t, err)
	assert.Equal(t, "stroke was encrypted with an older encryption key", err.Error())
}

func TestDrawStroke_PrivateLayer_KeyMatch(t *testing.T) {
	svc, _, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "user1", KeyVersion: 5}
	privateKey := "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="

	params := service.DrawParams{
		User:    user,
		PageKey: privateKey,
		Layer:   models.LayerPrivate,
		LayerId: "5", // Match!
		Stroke:  models.Stroke{},
	}

	mockCache.On("GetUserStrokeCount", ctx, user.Id).Return(10, nil)
	mockCache.On("IsPageComplete", ctx, privateKey).Return(true, nil)
	mockCache.On("GetPageStrokeCountFromZCard", ctx, privateKey).Return(int64(100), nil)

	// Async expectations
	mockCache.On("IncrementUserStrokeCount", mock.Anything, user.Id).Return(int64(11), nil)
	mockCache.On("AddStroke", mock.Anything, privateKey, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	mockCache.On("Publish", mock.Anything, "page:"+privateKey, mock.Anything).Return(nil)

	_, err := svc.DrawStroke(ctx, params)
	assert.NoError(t, err)
}

// Extra check specifically for the variable shadowing bug
func TestQuotaCheck_ShadowingRegression(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()
	user := models.User{Id: "u1"}
	pageKey := "example.com"

	// Setup: Cache not complete, Store returns OVER quota (2000)
	mockCache.On("GetUserStrokeCount", ctx, "u1").Return(0, nil)
	mockCache.On("IsPageComplete", ctx, pageKey).Return(false, nil)
	mockCache.On("GetStrokes", ctx, pageKey).Return([][]byte{}, nil)
	mockStore.On("GetPageStrokeCount", ctx, pageKey).Return(2000, nil)
	mockStore.On("GetStrokeRecords", ctx, pageKey).Return([]models.Stroke{}, nil)
	mockCache.On("SetPageComplete", ctx, pageKey).Return(nil)
	mockCache.On("AddStrokesBatch", ctx, pageKey, mock.Anything).Return(nil)
	mockCache.On("GetPageStrokeCountFromZCard", ctx, pageKey).Return(int64(2000), nil)

	// We can't call enforceUserAndPageQuota directly as it's private, but DrawStroke calls it.
	params := service.DrawParams{
		User:    user,
		PageKey: pageKey,
		Layer:   models.LayerPublic,
		Stroke:  models.Stroke{Content: []byte(`{"tool":0,"color":"#000000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`)},
	}

	_, err := svc.DrawStroke(ctx, params)

	// Regression test: ensures pageStrokeCount is updated (not shadowed) after cache miss
	// Previously, pageStrokeCount, err := ... created new var, bypassing quota checks
	assert.Error(t, err)
	if err != nil {
		assert.Equal(t, "page stroke quota exceeded", err.Error())
	}
}

func TestUndoStroke_Success(t *testing.T) {
	svc, mockStore, mockCache, _, strokeBatcher, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "user1"}
	params := service.UndoParams{
		User:     user,
		PageKey:  "example.com",
		Layer:    models.LayerPublic,
		LayerId:  "public",
		StrokeId: "stroke1",
	}

	// 1. Mock Store Delete (Success)
	mockStore.On("DeleteStroke", ctx, params.PageKey, params.StrokeId, user.Id).Return(nil)

	// 2. Async Expectations with channel synchronization
	removeStrokeDone := wrapMockWithSignal(mockCache.On("RemoveStroke", mock.Anything, params.PageKey, params.StrokeId).Return(nil))
	decrementUserDone := wrapMockWithSignal(mockCache.On("DecrementUserStrokeCount", mock.Anything, user.Id).Return(nil))
	publishDone := wrapMockWithSignal(mockCache.On("Publish", mock.Anything, "page:"+params.PageKey, mock.Anything).Return(nil))

	err := svc.UndoStroke(ctx, params)
	assert.NoError(t, err)

	// 3. Verify Batcher Delete Request
	select {
	case req := <-strokeBatcher.DeleteCh:
		assert.Equal(t, params.StrokeId, req.StrokeId)
		assert.Equal(t, user.Id, req.UserId)
	case <-time.After(100 * time.Millisecond):
		assert.Fail(t, "timed out waiting for delete request in batcher")
	}

	// Wait for all async operations
	select {
	case <-removeStrokeDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for RemoveStroke")
	}

	select {
	case <-decrementUserDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for DecrementUserStrokeCount")
	}

	select {
	case <-publishDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for Publish")
	}
}

func TestUndoStroke_AsyncCacheFails(t *testing.T) {
	svc, mockStore, mockCache, _, strokeBatcher, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "user1"}
	params := service.UndoParams{
		User:     user,
		PageKey:  "example.com",
		Layer:    models.LayerPublic,
		LayerId:  "public",
		StrokeId: "stroke1",
	}

	mockStore.On("DeleteStroke", ctx, params.PageKey, params.StrokeId, user.Id).Return(nil)

	// Async operations fail - but should not affect return value
	mockCache.On("RemoveStroke", mock.Anything, params.PageKey, params.StrokeId).Return(errors.New("cache error"))
	mockCache.On("DecrementUserStrokeCount", mock.Anything, user.Id).Return(errors.New("cache error"))
	mockCache.On("Publish", mock.Anything, "page:"+params.PageKey, mock.Anything).Return(errors.New("pubsub error"))

	err := svc.UndoStroke(ctx, params)

	// Should still succeed (async errors don't affect return)
	assert.NoError(t, err)

	// Verify batcher request still sent
	select {
	case <-strokeBatcher.DeleteCh:
		// Expected
	case <-time.After(100 * time.Millisecond):
		assert.Fail(t, "timed out waiting for delete request in batcher")
	}
}

func TestUndoStroke_NotOwner_Malicious(t *testing.T) {
	svc, mockStore, mockCache, _, strokeBatcher, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "malicious_user"}
	params := service.UndoParams{
		User:     user,
		PageKey:  "example.com",
		Layer:    models.LayerPublic,
		LayerId:  "public",
		StrokeId: "stroke_of_another_user",
	}

	// 1. Mock Store Delete returns ConditionFailed (Not Owner)
	mockStore.On("DeleteStroke", ctx, params.PageKey, params.StrokeId, user.Id).Return(store.ErrConditionFailed)

	// 2. Expect NO async calls (counters should NOT change)
	err := svc.UndoStroke(ctx, params)

	// Should return error
	assert.ErrorIs(t, err, store.ErrConditionFailed)

	// 3. Verify Batcher Request still sent (optimistic delete)
	select {
	case req := <-strokeBatcher.DeleteCh:
		assert.Equal(t, params.StrokeId, req.StrokeId)
	case <-time.After(100 * time.Millisecond):
		assert.Fail(t, "timed out waiting for delete request in batcher")
	}

	// 4. Verify Async Goroutine did NOT run - wait a bit to ensure no async calls happen
	time.Sleep(50 * time.Millisecond)
	mockCache.AssertNotCalled(t, "RemoveStroke", mock.Anything, mock.Anything, mock.Anything)
	mockCache.AssertNotCalled(t, "DecrementUserStrokeCount", mock.Anything, mock.Anything)
	mockCache.AssertNotCalled(t, "Publish", mock.Anything, mock.Anything, mock.Anything)
}

func TestUndoStroke_PrivateLayer_InvalidKey(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()

	err := svc.UndoStroke(ctx, service.UndoParams{
		User:    models.User{Id: "u1"},
		PageKey: "invalid-private-key",
		Layer:   models.LayerPrivate,
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid private page key")
}

func TestDrawStroke_InvalidContent(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()

	// Invalid JSON content
	params := service.DrawParams{
		User:    models.User{Id: "user1"},
		PageKey: "example.com",
		Layer:   models.LayerPublic,
		Stroke:  models.Stroke{Content: []byte(`{invalid_json}`)},
	}

	_, err := svc.DrawStroke(ctx, params)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid content format")
}

func TestDrawStroke_InvalidPageKey(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()

	// Invalid Public Page Key (missing dot)
	params := service.DrawParams{
		User:    models.User{Id: "user1"},
		PageKey: "localhost",
		Layer:   models.LayerPublic,
		Stroke:  models.Stroke{Content: []byte(`{"tool":0,"color":"#000000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`)},
	}

	_, err := svc.DrawStroke(ctx, params)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "public page key must contain a dot")
}

// Quota enforcement edge case tests

func TestEnforceUserAndPageQuota_UserCacheMiss_DBSeedsCache(t *testing.T) {
	svc, mockStore, mockCache, _, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:          "user1",
		Provider:    "google",
		ProviderId:  "123",
		StrokeCount: 500,
	}

	// User cache miss
	mockCache.On("GetUserStrokeCount", ctx, user.Id).Return(-1, nil)

	// DB returns user
	mockStore.On("GetUser", ctx, user.Provider, user.ProviderId).Return(user, nil)

	// Seed user count
	mockCache.On("SeedUserStrokeCount", ctx, user.Id, user.StrokeCount).Return(nil)

	// Page check
	mockCache.On("IsPageComplete", ctx, "example.com").Return(true, nil)
	mockCache.On("GetPageStrokeCountFromZCard", ctx, "example.com").Return(int64(100), nil)

	// Async expectations
	mockCache.On("IncrementUserStrokeCount", mock.Anything, user.Id).Return(int64(501), nil)
	mockCache.On("AddStroke", mock.Anything, "example.com", mock.Anything, mock.Anything, mock.Anything).Return(nil)
	mockCache.On("Publish", mock.Anything, "page:example.com", mock.Anything).Return(nil)

	params := service.DrawParams{
		User:    user,
		PageKey: "example.com",
		Layer:   models.LayerPublic,
		LayerId: "public",
		Stroke:  models.Stroke{Content: []byte(`{"tool":0,"color":"#000000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`)},
	}

	_, err := svc.DrawStroke(ctx, params)
	assert.NoError(t, err)
}
