package rest

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/zlnvch/webverse/service"
)

type Handler struct {
	Service *service.Service
}

func NewHandler(svc *service.Service) *Handler {
	return &Handler{Service: svc}
}

type loginRequest struct {
	Provider string `json:"provider"`
	Code     string `json:"code"`
}

type loginResponse struct {
	Username      string `json:"username"`
	Id            string `json:"id"`
	Provider      string `json:"provider"`
	Token         string `json:"token"`
	KeyVersion    int    `json:"keyVersion"`
	SaltKEK       string `json:"saltKEK"`
	EncryptedDEK1 string `json:"encryptedDEK1"`
	NonceDEK1     string `json:"nonceDEK1"`
	EncryptedDEK2 string `json:"encryptedDEK2"`
	NonceDEK2     string `json:"nonceDEK2"`
}

func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	user, token, err := h.Service.Login(r.Context(), req.Provider, req.Code)
	if err != nil {
		log.Printf("Login failed: %v", err)
		http.Error(w, "login failed", http.StatusInternalServerError)
		return
	}

	resp := loginResponse{
		Username:      user.Username,
		Id:            user.Id,
		Provider:      user.Provider,
		Token:         token,
		KeyVersion:    user.KeyVersion,
		SaltKEK:       user.SaltKEK,
		EncryptedDEK1: user.EncryptedDEK1,
		NonceDEK1:     user.NonceDEK1,
		EncryptedDEK2: user.EncryptedDEK2,
		NonceDEK2:     user.NonceDEK2,
	}
	h.sendResponse(w, resp)
}

type getUserResponse struct {
	Username      string `json:"username"`
	Id            string `json:"id"`
	Provider      string `json:"provider"`
	KeyVersion    int    `json:"keyVersion"`
	SaltKEK       string `json:"saltKEK"`
	EncryptedDEK1 string `json:"encryptedDEK1"`
	NonceDEK1     string `json:"nonceDEK1"`
	EncryptedDEK2 string `json:"encryptedDEK2"`
	NonceDEK2     string `json:"nonceDEK2"`
}

func (h *Handler) HandleMe(w http.ResponseWriter, r *http.Request) {
	token := h.getTokenFromAuthHeader(r)
	switch r.Method {
	case http.MethodGet:
		h.handleGetUser(w, r, token)

	case http.MethodDelete:
		h.handleDeleteUser(w, r, token)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleGetUser(w http.ResponseWriter, r *http.Request, token string) {
	user, err := h.Service.AuthenticateToken(r.Context(), token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	resp := getUserResponse{
		Username:      user.Username,
		Id:            user.Id,
		Provider:      user.Provider,
		KeyVersion:    user.KeyVersion,
		SaltKEK:       user.SaltKEK,
		EncryptedDEK1: user.EncryptedDEK1,
		NonceDEK1:     user.NonceDEK1,
		EncryptedDEK2: user.EncryptedDEK2,
		NonceDEK2:     user.NonceDEK2,
	}
	h.sendResponse(w, resp)
}

type deleteUserResponse struct {
	Success bool `json:"success"`
}

func (h *Handler) handleDeleteUser(w http.ResponseWriter, r *http.Request, token string) {
	user, err := h.Service.AuthenticateToken(r.Context(), token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	if err := h.Service.DeleteUser(r.Context(), user); err != nil {
		http.Error(w, "failed to delete user", http.StatusInternalServerError)
		return
	}

	resp := deleteUserResponse{
		Success: true,
	}
	h.sendResponse(w, resp)
}

func (h *Handler) HandleEncryptionKeys(w http.ResponseWriter, r *http.Request) {
	token := h.getTokenFromAuthHeader(r)
	user, err := h.Service.AuthenticateToken(r.Context(), token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodPost, http.MethodPut:
		var req encryptionKeysRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		keys := service.EncryptionKeys{
			SaltKEK:       req.SaltKEK,
			EncryptedDEK1: req.EncryptedDEK1,
			NonceDEK1:     req.NonceDEK1,
			EncryptedDEK2: req.EncryptedDEK2,
			NonceDEK2:     req.NonceDEK2,
		}

		keyVersion, err := h.Service.SetEncryptionKeys(r.Context(), user, keys, r.Method == http.MethodPost)
		if err != nil {
			log.Printf("Set encryption keys failed: %v", err)
			http.Error(w, "failed to store encryption keys", http.StatusInternalServerError)
			return
		}

		resp := encryptionKeysResponse{
			Success:    true,
			KeyVersion: keyVersion,
		}
		h.sendResponse(w, resp)

	case http.MethodDelete:
		if err := h.Service.DeleteEncryptionKeys(r.Context(), user); err != nil {
			http.Error(w, "failed to delete encryption keys", http.StatusInternalServerError)
			return
		}
		resp := deleteEncryptionKeysResponse{
			Success: true,
		}
		h.sendResponse(w, resp)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

type encryptionKeysRequest struct {
	SaltKEK       string `json:"saltKEK"`
	EncryptedDEK1 string `json:"encryptedDEK1"`
	NonceDEK1     string `json:"nonceDEK1"`
	EncryptedDEK2 string `json:"encryptedDEK2"`
	NonceDEK2     string `json:"nonceDEK2"`
}

type encryptionKeysResponse struct {
	Success    bool `json:"success"`
	KeyVersion int  `json:"keyVersion"`
}

type deleteEncryptionKeysResponse struct {
	Success bool `json:"success"`
}

func (h *Handler) sendResponse(w http.ResponseWriter, resp any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (h *Handler) getTokenFromAuthHeader(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return ""
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(authHeader, prefix) {
		return ""
	}
	return strings.TrimPrefix(authHeader, prefix)
}
