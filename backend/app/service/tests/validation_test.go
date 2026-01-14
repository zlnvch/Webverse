package service_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zlnvch/webverse/service"
)

func TestValidateStrokeContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
		wantErr string
	}{
		{
			"Valid",
			`{"tool":0,"color":"#ff0000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`,
			"",
		},
		{
			"Invalid JSON",
			`{bad}`,
			"invalid content format",
		},
		{
			"Invalid Tool",
			`{"tool":10,"color":"#ff0000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`,
			"invalid tool",
		},
		{
			"Invalid Color Format",
			`{"tool":0,"color":"red","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`,
			"invalid color",
		},
		{
			"Color Too Long",
			`{"tool":0,"color":"#ff00000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`,
			"invalid color",
		},
		{
			"Width Too Small",
			`{"tool":0,"color":"#ff0000","width":0,"startX":0,"startY":0,"dx":[],"dy":[]}`,
			"invalid width",
		},
		{
			"Width Too Large",
			`{"tool":0,"color":"#ff0000","width":21,"startX":0,"startY":0,"dx":[],"dy":[]}`,
			"invalid width",
		},
		{
			"Empty Arrays (Valid)",
			`{"tool":0,"color":"#ff0000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`,
			"",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := service.ValidateStrokeContent([]byte(tc.content))
			if tc.wantErr == "" {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tc.wantErr)
			}
		})
	}

	t.Run("Real Stroke Too Long", func(t *testing.T) {
		dx := make([]int32, 1001)
		dy := make([]int32, 1001)
		content := struct {
			Tool   int     `json:"tool"`
			Color  string  `json:"color"`
			Width  int     `json:"width"`
			StartX int     `json:"startX"`
			StartY int     `json:"startY"`
			Dx     []int32 `json:"dx"`
			Dy     []int32 `json:"dy"`
		}{0, "#000000", 5, 0, 0, dx, dy}
		b, _ := json.Marshal(content)
		err := service.ValidateStrokeContent(b)
		assert.Error(t, err)
		assert.Equal(t, "stroke too long", err.Error())
	})
}

func TestValidatePageKey_Public(t *testing.T) {
	tests := []struct {
		key     string
		valid   bool
		wantErr string
	}{
		{"example.com", true, ""},
		{"sub.domain.org", true, ""},
		{"localhost", false, "must contain a dot"},
		{"127.0.0.1", false, "must not be an IP address"},
		{"192.168.1.1", false, "must not be an IP address"},
		{"https://example.com", false, "must not contain protocol"},
		{"ws://example.com", false, "must not contain protocol"},
		{"www.example.com", false, "must not start with www."},
		{"example.com/path", true, ""}, // Paths are allowed if normalized
		{"example.com?query=1", false, "must not contain query or fragment"},
		{"example.com#hash", false, "must not contain query or fragment"},
		{"example.com/", false, "must not have trailing slash"},
		{"example.com:8080", false, "must not contain port"},
		{"google.com", true, ""},
		{"[2001:db8::1]", false, "must contain a dot"},
	}

	for _, tc := range tests {
		err := service.ValidatePageKey(tc.key, false)
		if tc.valid {
			assert.NoError(t, err, "Key: %s", tc.key)
		} else {
			assert.Error(t, err, "Key: %s", tc.key)
			if tc.wantErr != "" {
				assert.Contains(t, err.Error(), tc.wantErr)
			}
		}
	}
}

func TestValidatePageKey_Private(t *testing.T) {
	// 32 bytes of 'a' encoded in base64
	validKey := "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="

	assert.NoError(t, service.ValidatePageKey(validKey, true))

	// Too short (24 bytes)
	shortKey := "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFh"
	assert.Error(t, service.ValidatePageKey(shortKey, true))
	assert.Contains(t, service.ValidatePageKey(shortKey, true).Error(), "length")

	// Invalid Base64
	assert.Error(t, service.ValidatePageKey("!!!notbase64!!!", true))
}

// Fuzz tests for input validation functions
// These tests use randomized input to find edge cases and vulnerabilities

// FuzzValidateStrokeContent tests stroke content validation with random bytes
func FuzzValidateStrokeContent(f *testing.F) {
	// Add seed corpus with valid and edge case inputs
	f.Add([]byte(`{"tool":0,"color":"#000000","width":5,"startX":0,"startY":0,"dx":[],"dy":[]}`))
	f.Add([]byte(`{"tool":1,"color":"#ffffff","width":20,"startX":100,"startY":100,"dx":[10,20],"dy":[10,20]}`))
	f.Add([]byte(`{"tool":99,"color":"#abc","width":0,"startX":0,"startY":0,"dx":[],"dy":[]}`)) // Invalid tool
	f.Add([]byte(`{invalid json}`))
	f.Add([]byte{})
	f.Add([]byte(`{"tool":0,"color":"#000000","width":5,"points":[`)) // Large array

	f.Fuzz(func(t *testing.T, input []byte) {
		// The function should never panic
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("validateStrokeContent panicked with input: %x\npanic: %v", input, r)
			}
		}()

		// Call the validation function - should handle all input gracefully
		_ = service.ValidateStrokeContent(input)
	})
}

// FuzzValidatePageKey_Public tests public page key validation with random strings
func FuzzValidatePageKey_Public(f *testing.F) {
	// Add seed corpus with valid and invalid keys
	f.Add([]byte("example.com"))
	f.Add([]byte("google.com"))
	f.Add([]byte("localhost")) // Invalid - no dot
	f.Add([]byte("https://example.com")) // Invalid - has protocol
	f.Add([]byte("192.168.1.1")) // Invalid - IP address
	f.Add([]byte("")) // Empty
	f.Add([]byte("a.b")) // Minimal valid
	f.Add([]byte(strings.Repeat("a", 1000))) // Very long key

	f.Fuzz(func(t *testing.T, input []byte) {
		// Should never panic
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("ValidatePageKey panicked with input: %s\npanic: %v", string(input), r)
			}
		}()

		_ = service.ValidatePageKey(string(input), false)
	})
}

// FuzzValidatePageKey_Private tests private key validation with random bytes
func FuzzValidatePageKey_Private(f *testing.F) {
	// Add seed corpus with valid and invalid base64 keys
	f.Add([]byte("YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=")) // Valid (32 bytes)
	f.Add([]byte("invalid base64!!!"))
	f.Add([]byte("YWVjYWJjYWJjYWJjYWJjYWJj")) // Too short (24 bytes)
	f.Add([]byte(strings.Repeat("YQ==", 100))) // Too long
	f.Add([]byte{})

	f.Fuzz(func(t *testing.T, input []byte) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("ValidatePageKey(private) panicked with input: %x\npanic: %v", input, r)
			}
		}()

		_ = service.ValidatePageKey(string(input), true)
	})
}


