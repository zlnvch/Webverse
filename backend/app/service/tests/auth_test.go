package service_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/zlnvch/webverse/models"
	"golang.org/x/oauth2"
)

func TestCreateAndVerifyJWT(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)

	id := "user123"
	provider := "google"
	providerId := "p123"

	// 1. Create
	token, err := svc.CreateJWT(id, provider, providerId)
	assert.NoError(t, err)
	assert.NotEmpty(t, token)

	// 2. Verify
	gotId, gotProvider, gotProviderId, expiry, err := svc.VerifyJWT(token)
	assert.NoError(t, err)
	assert.Equal(t, id, gotId)
	assert.Equal(t, provider, gotProvider)
	assert.Equal(t, providerId, gotProviderId)
	assert.True(t, expiry.After(time.Now()))
}

func TestVerifyJWT_Invalid(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)

	_, _, _, _, err := svc.VerifyJWT("invalid.token.string")
	assert.Error(t, err)
}

func TestVerifyJWT_Empty(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)

	// Test with empty token
	_, _, _, _, err := svc.VerifyJWT("")
	assert.Error(t, err)
}

func TestAuthenticateToken_Success(t *testing.T) {
	svc, mockStore, _, _, _, _ := setupService(t)
	ctx := context.Background()

	// 1. Setup User and Token
	user := models.User{
		Id:         "user1",
		Provider:   "github",
		ProviderId: "gh123",
		Username:   "testuser",
	}
	token, _ := svc.CreateJWT(user.Id, user.Provider, user.ProviderId)

	// 2. Mock Store
	mockStore.On("GetUser", ctx, user.Provider, user.ProviderId).Return(user, nil)

	// 3. Authenticate
	gotUser, err := svc.AuthenticateToken(ctx, token)
	assert.NoError(t, err)
	assert.Equal(t, user.Id, gotUser.Id)
	assert.Equal(t, user.Username, gotUser.Username)
}

func TestAuthenticateToken_UserNotFound(t *testing.T) {
	svc, mockStore, _, _, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{Id: "u1", Provider: "p", ProviderId: "pid"}
	token, _ := svc.CreateJWT(user.Id, user.Provider, user.ProviderId)

	// Mock Store error
	mockStore.On("GetUser", ctx, user.Provider, user.ProviderId).Return(models.User{}, assert.AnError)

	_, err := svc.AuthenticateToken(ctx, token)
	assert.Error(t, err)
}

func TestAuthenticateToken_EmptyToken(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)
	ctx := context.Background()

	_, err := svc.AuthenticateToken(ctx, "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "token not provided")
}

func TestHandleOauth_UnsupportedProvider(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)

	_, err := svc.HandleOauth(context.Background(), "unsupported", "code")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported provider")
}

func TestHandleOauth_TokenExchangeFails(t *testing.T) {
	// Create a test server that returns an error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "invalid_code",
		})
	}))
	defer server.Close()

	oauthConfigs := map[string]*oauth2.Config{
		"github": {
			Endpoint: oauth2.Endpoint{
				AuthURL:  server.URL + "/auth",
				TokenURL: server.URL + "/token",
			},
			RedirectURL: "http://localhost/callback",
		},
	}

	svc, _, _, _, _, _ := setupService(t)
	svc.OAuthConfigs = oauthConfigs

	_, err := svc.HandleOauth(context.Background(), "github", "invalid_code")
	assert.Error(t, err)
}

// Note: HandleOauth and TestLogin tests below cannot work properly because oauthAPIs uses hardcoded URLs
// These would require either:
// 1. Modifying the service code to inject oauthAPIs
// 2. Using an HTTP proxy to intercept requests
// 3. Integration tests with real OAuth providers
// The existing TestHandleOauth_UnsupportedProvider and TestHandleOauth_TokenExchangeFails cover the testable error paths

func TestLogin_CreateUserFails(t *testing.T) {
	t.Skip("Cannot test without mocking HandleOauth properly")
}

func TestLogin_TokenGenerationFails(t *testing.T) {
	t.Skip("Cannot test without mocking HandleOauth properly")
}

func TestLogin_Success(t *testing.T) {
	t.Skip("Cannot test without mocking HandleOauth properly")
}

func TestHandleOauth_HTTPRequestFails(t *testing.T) {
	t.Skip("Requires hardcoded oauthAPIs to be mocked - not testable without service code changes")
}

func TestHandleOauth_InvalidJSONResponse(t *testing.T) {
	t.Skip("Requires hardcoded oauthAPIs to be mocked - not testable without service code changes")
}

func TestHandleOauth_MissingFieldsInResponse(t *testing.T) {
	t.Skip("Requires hardcoded oauthAPIs to be mocked - not testable without service code changes")
}

func TestVerifyJWT_InvalidSigningMethod(t *testing.T) {
	svc, _, _, _, _, _ := setupService(t)

	// Create a JWT with "none" algorithm (critical security test)
	// This tests that the service properly rejects the "none" algorithm attack vector
	// where attackers try to bypass signature verification by setting alg to "none"

	header := map[string]string{
		"alg": "none",
		"typ": "JWT",
	}
	payload := map[string]any{
		"id":         "attacker_user",
		"provider":   "github",
		"providerId": "attacker_123",
		"exp":        time.Now().Add(24 * time.Hour).Unix(),
		"iat":        time.Now().Unix(),
	}

	headerBytes, _ := json.Marshal(header)
	payloadBytes, _ := json.Marshal(payload)

	// Base64URL encode without padding
	enc := base64.RawURLEncoding
	headerEncoded := enc.EncodeToString(headerBytes)
	payloadEncoded := enc.EncodeToString(payloadBytes)

	// "none" algorithm JWT has empty signature
	noneToken := headerEncoded + "." + payloadEncoded + "."

	_, _, _, _, err := svc.VerifyJWT(noneToken)
	assert.Error(t, err)
	// The error should indicate that the signing method is invalid
	assert.Contains(t, err.Error(), "signing method none is invalid")
}

func TestDeleteUser_Success(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:         "user1",
		Provider:   "google",
		ProviderId: "123",
	}

	// 1. Mock Store Delete
	mockStore.On("DeleteUser", ctx, user.Provider, user.ProviderId).Return(nil)

	// 2. Async Expectations with channel synchronization
	publishDone := wrapMockWithSignal(mockCache.On("Publish", mock.Anything, "user-deleted", mock.MatchedBy(func(msg []byte) bool {
		return string(msg) == `{"UserId":"user1"}`
	})).Return(nil))

	mqSendDone := wrapMockWithSignal(mockMQ.On("Send", mock.Anything, mock.MatchedBy(func(body string) bool {
		return strings.Contains(body, `"userId":"user1"`) && strings.Contains(body, `"deleteAll":true`)
	})).Return(nil))

	err := svc.DeleteUser(ctx, user)
	assert.NoError(t, err)

	// Wait for async operations to complete
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

func TestDeleteUser_AsyncPublishFails(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:         "user1",
		Provider:   "google",
		ProviderId: "123",
	}

	mockStore.On("DeleteUser", ctx, user.Provider, user.ProviderId).Return(nil)

	// Publish fails in async goroutine
	mockCache.On("Publish", mock.Anything, "user-deleted", mock.Anything).Return(errors.New("pubsub failed"))
	mockMQ.On("Send", mock.Anything, mock.Anything).Return(nil)

	err := svc.DeleteUser(ctx, user)

	// Should still succeed (async errors don't affect return)
	assert.NoError(t, err)
}

func TestDeleteUser_AsyncMQSendFails(t *testing.T) {
	svc, mockStore, mockCache, mockMQ, _, _ := setupService(t)
	ctx := context.Background()

	user := models.User{
		Id:         "user1",
		Provider:   "google",
		ProviderId: "123",
	}

	mockStore.On("DeleteUser", ctx, user.Provider, user.ProviderId).Return(nil)

	mockCache.On("Publish", mock.Anything, "user-deleted", mock.Anything).Return(nil)
	// MQ send fails in async goroutine
	mockMQ.On("Send", mock.Anything, mock.Anything).Return(errors.New("mq failed"))

	err := svc.DeleteUser(ctx, user)

	// Should still succeed (async errors don't affect return)
	assert.NoError(t, err)
}
