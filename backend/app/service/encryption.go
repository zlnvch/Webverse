package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/zlnvch/webverse/models"
	"github.com/zlnvch/webverse/worker"
)

type EncryptionKeys struct {
	SaltKEK       string
	EncryptedDEK1 string
	NonceDEK1     string
	EncryptedDEK2 string
	NonceDEK2     string
}

type UserKeysUpdatedMessage struct {
	UserId      string
	KeyVersion  int
	KeysDeleted bool
}

func (s *Service) SetEncryptionKeys(ctx context.Context, user models.User, keys EncryptionKeys, isNew bool) (int, error) {
	if err := validateEncryptionKeys(keys); err != nil {
		return 0, err
	}

	hadEncryptionKeys := len(user.SaltKEK) > 0

	// Cannot rotate keys that don't exist
	if !isNew && !hadEncryptionKeys {
		return 0, errors.New("cannot rotate keys: user has no existing keys")
	}

	prevKeyVersion := user.KeyVersion

	user.SaltKEK = keys.SaltKEK
	user.EncryptedDEK1 = keys.EncryptedDEK1
	user.NonceDEK1 = keys.NonceDEK1
	user.EncryptedDEK2 = keys.EncryptedDEK2
	user.NonceDEK2 = keys.NonceDEK2

	keyVersion, err := s.Store.SetUserEncryptionKeys(ctx, user, isNew)
	if err != nil {
		return 0, err
	}

	// Async side-effects - return to caller as soon as as store operation is done
	go func() {
		userKeysUpdatedMsg := UserKeysUpdatedMessage{UserId: user.Id, KeyVersion: keyVersion, KeysDeleted: false}
		if msgBytes, err := json.Marshal(userKeysUpdatedMsg); err == nil {
			s.Cache.Publish(context.Background(), "user-keys-updated", msgBytes)
		}

		if isNew && hadEncryptionKeys {
			// Keys were overwritten (reset via POST on existing keys)
			// We must delete strokes encrypted with the old keys
			msg := worker.DeleteUserStrokesMessage{
				UserId:         user.Id,
				UserProvider:   user.Provider,
				UserProviderId: user.ProviderId,
				DeleteAll:      false,
				Layer:          "Private#" + fmt.Sprint(prevKeyVersion),
			}
			if msgBytes, err := json.Marshal(msg); err == nil {
				s.MQ.Send(context.Background(), string(msgBytes))
			}
		}
	}()

	return keyVersion, nil
}

func (s *Service) DeleteEncryptionKeys(ctx context.Context, user models.User) error {
	hadEncryptionKeys := len(user.SaltKEK) > 0
	prevKeyVersion := user.KeyVersion

	user.SaltKEK = ""
	user.EncryptedDEK1 = ""
	user.NonceDEK1 = ""
	user.EncryptedDEK2 = ""
	user.NonceDEK2 = ""

	if _, err := s.Store.SetUserEncryptionKeys(ctx, user, false); err != nil {
		return err
	}

	// Async side-effects - return to caller as soon as as store operation is done
	go func() {
		if hadEncryptionKeys {
			userKeysUpdatedMsg := UserKeysUpdatedMessage{UserId: user.Id, KeyVersion: prevKeyVersion, KeysDeleted: true}
			if userKeysUpdatedMsgBytes, err := json.Marshal(userKeysUpdatedMsg); err == nil {
				s.Cache.Publish(ctx, "user-keys-updated", userKeysUpdatedMsgBytes)
			}

			msg := worker.DeleteUserStrokesMessage{
				UserId:         user.Id,
				UserProvider:   user.Provider,
				UserProviderId: user.ProviderId,
				DeleteAll:      false,
				Layer:          "Private#" + fmt.Sprint(prevKeyVersion),
			}
			if msgBytes, err := json.Marshal(msg); err == nil {
				s.MQ.Send(ctx, string(msgBytes))
			}
		}
	}()

	return nil
}

func validateEncryptionKeys(k EncryptionKeys) error {
	const (
		encryptedKeyBits = 256 + 128
		nonceBits        = 192
	)
	fields := []struct {
		name  string
		value string
		want  int
	}{
		{"EncryptedDEK1", k.EncryptedDEK1, encryptedKeyBits},
		{"EncryptedDEK2", k.EncryptedDEK2, encryptedKeyBits},
		{"NonceDEK1", k.NonceDEK1, nonceBits},
		{"NonceDEK2", k.NonceDEK2, nonceBits},
	}
	for _, f := range fields {
		bits, err := base64LengthBits(f.value)
		if err != nil {
			return fmt.Errorf("%s: invalid Base64: %w", f.name, err)
		}
		if bits != f.want {
			return fmt.Errorf("%s: invalid length, got %d bits, want %d bits", f.name, bits, f.want)
		}
	}
	return nil
}

func base64LengthBits(s string) (int, error) {
	data, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return 0, err
	}
	return len(data) * 8, nil
}
