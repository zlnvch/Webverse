package service_test

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/zlnvch/webverse/models"
	"github.com/zlnvch/webverse/service"
)

// Helper to generate base64 string of specific byte length
func makeBase64(bytes int) string {
	b := make([]byte, bytes)
	return base64.StdEncoding.EncodeToString(b)
}

func TestSetEncryptionKeys_Success(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "user1", KeyVersion: 1}

	// 48 bytes (384 bits) for Keys, 24 bytes (192 bits) for Nonces
	keys := service.EncryptionKeys{
		SaltKEK:       "somesalt",
		EncryptedDEK1: makeBase64(48),
		NonceDEK1:     makeBase64(24),
		EncryptedDEK2: makeBase64(48),
		NonceDEK2:     makeBase64(24),
	}

	// 1. Mock Store (Expect incrementKeyVersion=true for new keys)
	mockStore.On("SetUserEncryptionKeys", ctx, mock.MatchedBy(func(u models.User) bool {
		return u.Id == user.Id &&
			u.EncryptedDEK1 == keys.EncryptedDEK1 &&
			u.NonceDEK1 == keys.NonceDEK1 &&
			u.EncryptedDEK2 == keys.EncryptedDEK2 &&
			u.NonceDEK2 == keys.NonceDEK2 &&
			u.SaltKEK == keys.SaltKEK
	}), true).Return(2, nil)

	// 2. Async Expectations with channel synchronization
	publishDone := wrapMockWithSignal(mockCache.On("Publish", mock.Anything, "user-keys-updated", mock.Anything).Return(nil))

	// User has no existing keys (user.SaltKEK is empty), so MQ Send should NOT be called
	// MQ is only called when replacing existing keys

	newVersion, err := svc.SetEncryptionKeys(ctx, user, keys, true)
	assert.NoError(t, err)
	assert.Equal(t, 2, newVersion)

	// Wait for async operations
	select {
	case <-publishDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for Publish")
	}

	// Verify MQ was NOT called
	mockMQ.AssertNotCalled(t, "Send", mock.Anything, mock.Anything)
}

func TestSetEncryptionKeys_Validation(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()
	user := models.User{Id: "u1"}

	// Invalid Lengths
	keys := service.EncryptionKeys{
		EncryptedDEK1: makeBase64(10), // Too short
		NonceDEK1:     makeBase64(24),
	}

	_, err := svc.SetEncryptionKeys(ctx, user, keys, true)
	assert.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "invalid length"))
}

func TestSetEncryptionKeys_InvalidBase64(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()
	user := models.User{Id: "u1"}

	keys := service.EncryptionKeys{
		SaltKEK:       "valid",
		EncryptedDEK1: "!!!notbase64!!!",
		NonceDEK1:     makeBase64(24),
		EncryptedDEK2: makeBase64(48),
		NonceDEK2:     makeBase64(24),
	}

	_, err := svc.SetEncryptionKeys(ctx, user, keys, true)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid Base64")
}

func TestSetEncryptionKeys_KeyReplacement(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	// User already has keys (hadEncryptionKeys = true)
	user := models.User{
		Id:         "user1",
		KeyVersion: 1,
		SaltKEK:    "existing_salt",
	}

	keys := service.EncryptionKeys{
		SaltKEK:       "newsalt",
		EncryptedDEK1: makeBase64(48),
		NonceDEK1:     makeBase64(24),
		EncryptedDEK2: makeBase64(48),
		NonceDEK2:     makeBase64(24),
	}

	// Mock store call
	mockStore.On("SetUserEncryptionKeys", ctx, mock.Anything, true).Return(2, nil)

	// Both Publish and MQ Send should be called
	publishDone := wrapMockWithSignal(mockCache.On("Publish", mock.Anything, "user-keys-updated", mock.Anything).Return(nil))
	mqSendDone := wrapMockWithSignal(mockMQ.On("Send", mock.Anything, mock.MatchedBy(func(body string) bool {
		// Should delete old Private#1 strokes
		return strings.Contains(body, `"layer":"Private#1"`)
	})).Return(nil))

	newVersion, err := svc.SetEncryptionKeys(ctx, user, keys, true)
	assert.NoError(t, err)
	assert.Equal(t, 2, newVersion)

	// Wait for async operations
	select {
	case <-publishDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for Publish")
	}

	select {
	case <-mqSendDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for MQ Send")
	}
}

func TestSetEncryptionKeys_KeyRotation_PUT(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	// User already has keys, performing PUT (key rotation, isNew=false)
	user := models.User{
		Id:         "user1",
		KeyVersion: 1,
		SaltKEK:    "old_kek_salt",
	}

	keys := service.EncryptionKeys{
		SaltKEK:       "new_kek_salt",      // Only KEK changes
		EncryptedDEK1: makeBase64(48),     // DEK stays the same (re-encrypted with new KEK)
		NonceDEK1:     makeBase64(24),
		EncryptedDEK2: makeBase64(48),
		NonceDEK2:     makeBase64(24),
	}

	// Mock store call (isNew=false for PUT)
	mockStore.On("SetUserEncryptionKeys", ctx, mock.Anything, false).Return(2, nil)

	// Publish should be called, but MQ Send should NOT be called
	publishDone := wrapMockWithSignal(mockCache.On("Publish", mock.Anything, "user-keys-updated", mock.Anything).Return(nil))

	newVersion, err := svc.SetEncryptionKeys(ctx, user, keys, false)
	assert.NoError(t, err)
	assert.Equal(t, 2, newVersion)

	// Wait for Publish
	select {
	case <-publishDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for Publish")
	}

	// Verify MQ Send was NOT called (no old strokes deleted, DEK unchanged)
	mockMQ.AssertNotCalled(t, "Send", mock.Anything, mock.Anything)
}

func TestSetEncryptionKeys_PUT_NoExistingKeys(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()

	// User has NO existing keys
	user := models.User{
		Id:         "user1",
		KeyVersion: 0,
		SaltKEK:    "",
	}

	keys := service.EncryptionKeys{
		SaltKEK:       "new_kek_salt",
		EncryptedDEK1: makeBase64(48),
		NonceDEK1:     makeBase64(24),
		EncryptedDEK2: makeBase64(48),
		NonceDEK2:     makeBase64(24),
	}

	// PUT request with no existing keys should fail
	_, err := svc.SetEncryptionKeys(ctx, user, keys, false)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot rotate keys")
	assert.Contains(t, err.Error(), "no existing keys")
}

func TestDeleteEncryptionKeys_Success(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	// User HAD keys
	user := models.User{
		Id:         "user1",
		KeyVersion: 5,
		SaltKEK:    "existing",
	}

	// 1. Mock Store (Update with empty fields, increment=false)
	mockStore.On("SetUserEncryptionKeys", ctx, mock.MatchedBy(func(u models.User) bool {
		return u.SaltKEK == "" &&
			u.EncryptedDEK1 == "" &&
			u.NonceDEK1 == "" &&
			u.EncryptedDEK2 == "" &&
			u.NonceDEK2 == ""
	}), false).Return(5, nil)

	// 2. Async Expectations with channel synchronization
	publishDone := wrapMockWithSignal(mockCache.On("Publish", mock.Anything, "user-keys-updated", mock.Anything).Return(nil))
	mqSendDone := wrapMockWithSignal(mockMQ.On("Send", mock.Anything, mock.MatchedBy(func(body string) bool {
		return strings.Contains(body, `"layer":"Private#5"`)
	})).Return(nil))

	err := svc.DeleteEncryptionKeys(ctx, user)
	assert.NoError(t, err)

	// Wait for async operations
	select {
	case <-publishDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for Publish")
	}

	select {
	case <-mqSendDone:
	case <-time.After(1 * time.Second):
		assert.Fail(t, "timed out waiting for MQ Send")
	}
}

func TestDeleteEncryptionKeys_NoExistingKeys(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	// User has NO keys
	user := models.User{
		Id:         "user1",
		KeyVersion: 5,
		SaltKEK:    "", // Empty means no keys
	}

	mockStore.On("SetUserEncryptionKeys", ctx, mock.Anything, false).Return(5, nil)

	// No async operations should be called because hadEncryptionKeys = false

	err := svc.DeleteEncryptionKeys(ctx, user)
	assert.NoError(t, err)

	// Wait a bit to ensure no async calls happen
	time.Sleep(50 * time.Millisecond)
	mockCache.AssertNotCalled(t, "Publish", mock.Anything, mock.Anything, mock.Anything)
	mockMQ.AssertNotCalled(t, "Send", mock.Anything, mock.Anything)
}

func TestDeleteEncryptionKeys_AsyncPublishFails(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:         "user1",
		KeyVersion: 5,
		SaltKEK:    "existing",
	}

	mockStore.On("SetUserEncryptionKeys", ctx, mock.Anything, false).Return(5, nil)

	// Publish fails in async goroutine
	mockCache.On("Publish", mock.Anything, "user-keys-updated", mock.Anything).Return(errors.New("pubsub failed"))
	mockMQ.On("Send", mock.Anything, mock.Anything).Return(nil)

	err := svc.DeleteEncryptionKeys(ctx, user)

	// Should still succeed (async errors don't affect return)
	assert.NoError(t, err)
}

func TestDeleteEncryptionKeys_AsyncMQSendFails(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:         "user1",
		KeyVersion: 5,
		SaltKEK:    "existing",
	}

	mockStore.On("SetUserEncryptionKeys", ctx, mock.Anything, false).Return(5, nil)

	mockCache.On("Publish", mock.Anything, "user-keys-updated", mock.Anything).Return(nil)
	// MQ send fails in async goroutine
	mockMQ.On("Send", mock.Anything, mock.Anything).Return(errors.New("mq failed"))

	err := svc.DeleteEncryptionKeys(ctx, user)

	// Should still succeed (async errors don't affect return)
	assert.NoError(t, err)
}
