package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/zlnvch/webverse/models"
	"github.com/zlnvch/webverse/worker"
	"golang.org/x/oauth2"
)

// Provider-specific structs
type gitHubUser struct {
	Login string `json:"login"`
	ID    int    `json:"id"`
}

type googleUser struct {
	Email string `json:"email"`
	Sub   string `json:"sub"`
}

var oauthAPIs = map[string]struct {
	URL     string
	Headers map[string]string
}{
	"github": {
		URL: "https://api.github.com/user",
		Headers: map[string]string{
			"X-GitHub-Api-Version": "2022-11-28",
		},
	},
	"google": {
		URL:     "https://openidconnect.googleapis.com/v1/userinfo",
		Headers: map[string]string{},
	},
}

var oauthConfigsTemplate = map[string]*oauth2.Config{
	"github": {
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://github.com/login/oauth/authorize",
			TokenURL: "https://github.com/login/oauth/access_token",
		},
		Scopes: []string{""},
	},
	"google": {
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
			TokenURL: "https://oauth2.googleapis.com/token",
		},
		Scopes: []string{"openid", "email"},
	},
}

func addOauthEndpointsAndScopes(oauthConfigs map[string]*oauth2.Config) (map[string]*oauth2.Config, error) {
	for provider := range oauthConfigs {
		template, ok := oauthConfigsTemplate[provider]
		if !ok {
			return nil, fmt.Errorf("unsupported provider: %s", provider)
		}
		oauthConfigs[provider].Endpoint = template.Endpoint
		oauthConfigs[provider].Scopes = template.Scopes
	}

	return oauthConfigs, nil
}

func (s *Service) HandleOauth(ctx context.Context, provider string, code string) (models.User, error) {
	conf, ok := s.OAuthConfigs[provider]
	if !ok {
		return models.User{}, fmt.Errorf("unsupported provider: %s", provider)
	}

	tok, err := conf.Exchange(ctx, code)
	if err != nil {
		log.Println("Error:", err)
		return models.User{}, err
	}

	client := conf.Client(ctx, tok)
	api, ok := oauthAPIs[provider]
	if !ok {
		return models.User{}, fmt.Errorf("unsupported provider: %s", provider)
	}

	req, err := http.NewRequest("GET", api.URL, nil)
	if err != nil {
		log.Println("Error:", err)
		return models.User{}, err
	}
	for k, v := range api.Headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := client.Do(req)
	if err != nil {
		log.Println("Error:", err)
		return models.User{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Println("Error:", err)
		return models.User{}, err
	}

	return parseUser(body, provider)
}

func parseUser(jsonData []byte, provider string) (models.User, error) {
	var u models.User
	u.Provider = provider

	switch provider {
	case "github":
		var gh gitHubUser
		if err := json.Unmarshal(jsonData, &gh); err != nil {
			return models.User{}, err
		}
		u.Username = gh.Login
		u.ProviderId = strconv.Itoa(gh.ID)
	case "google":
		var g googleUser
		if err := json.Unmarshal(jsonData, &g); err != nil {
			return models.User{}, err
		}
		u.Username = g.Email
		u.ProviderId = g.Sub
	default:
		return models.User{}, fmt.Errorf("unsupported provider: %s", provider)
	}

	return u, nil
}

func (s *Service) CreateJWT(id string, provider string, providerId string) (string, error) {
	claims := jwt.MapClaims{
		"id":         id,
		"provider":   provider,
		"providerId": providerId,
		"exp":        time.Now().Add(24 * time.Hour).Unix(),
		"iat":        time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedToken, err := token.SignedString(s.JWTSecret)
	if err != nil {
		return "", err
	}

	return signedToken, nil
}

func (s *Service) VerifyJWT(tokenString string) (string, string, string, time.Time, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		return s.JWTSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return "", "", "", time.Time{}, err
	}

	if !token.Valid {
		return "", "", "", time.Time{}, errors.New("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", "", "", time.Time{}, errors.New("invalid token claims")
	}

	id, ok := claims["id"].(string)
	if !ok {
		return "", "", "", time.Time{}, errors.New("missing id claim")
	}

	provider, ok := claims["provider"].(string)
	if !ok {
		return "", "", "", time.Time{}, errors.New("missing provider claim")
	}

	providerId, ok := claims["providerId"].(string)
	if !ok {
		return "", "", "", time.Time{}, errors.New("missing providerId claim")
	}

	expFloat, ok := claims["exp"].(float64)
	if !ok {
		return "", "", "", time.Time{}, errors.New("missing exp claim")
	}
	expiry := time.Unix(int64(expFloat), 0)

	return id, provider, providerId, expiry, nil
}

func (s *Service) AuthenticateToken(ctx context.Context, token string) (models.User, error) {
	if len(token) == 0 {
		return models.User{}, errors.New("token not provided")
	}

	_, provider, providerId, _, err := s.VerifyJWT(token)
	if err != nil {
		return models.User{}, err
	}

	user, err := s.Store.GetUser(ctx, provider, providerId)
	if err != nil {
		return models.User{}, err
	}

	return user, nil
}

func (s *Service) Login(ctx context.Context, provider, code string) (models.User, string, error) {
	user, err := s.HandleOauth(ctx, provider, code)
	if err != nil {
		return models.User{}, "", fmt.Errorf("oauth failed: %w", err)
	}

	createdUser, err := s.Store.CreateUser(ctx, user)
	if err != nil {
		return models.User{}, "", fmt.Errorf("create user failed: %w", err)
	}

	token, err := s.CreateJWT(createdUser.Id, createdUser.Provider, createdUser.ProviderId)
	if err != nil {
		return models.User{}, "", fmt.Errorf("token generation failed: %w", err)
	}

	return createdUser, token, nil
}

type UserDeletedMessage struct {
	UserId string
}

func (s *Service) DeleteUser(ctx context.Context, user models.User) error {
	if err := s.Store.DeleteUser(ctx, user.Provider, user.ProviderId); err != nil {
		return err
	}

	// Async side-effects - return to caller as soon as as store operation is done
	go func() {
		userDeletedMsg := UserDeletedMessage{UserId: user.Id}
		if userDeletedMsgBytes, err := json.Marshal(userDeletedMsg); err == nil {
			s.Cache.Publish(context.Background(), "user-deleted", userDeletedMsgBytes)
		}

		msg := worker.DeleteUserStrokesMessage{
			UserId:         user.Id,
			UserProvider:   user.Provider,
			UserProviderId: user.ProviderId,
			DeleteAll:      true,
		}
		if msgBytes, err := json.Marshal(msg); err == nil {
			s.MQ.Send(context.Background(), string(msgBytes))
		}
	}()

	return nil
}
