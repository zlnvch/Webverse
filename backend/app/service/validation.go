package service

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"
)

type Tool int

const (
	ToolPen Tool = iota
	ToolEraser
	ToolCount
)

// strokeContent is defined here rather than in models because it is
// only used once to validate public strokes received from clients
// We do not store strokes as a struct but a raw byte array
// and the frontend handles unmarshalling into the strokeContent interface
// That way the store doesn't care whether or not the stroke content is encrypted
type strokeContent struct {
	Tool   Tool    `json:"tool"`
	Color  string  `json:"color"`
	Width  uint8   `json:"width"`
	StartX uint32  `json:"startX"`
	StartY uint32  `json:"startY"`
	Dx     []int32 `json:"dx"`
	Dy     []int32 `json:"dy"`
}

var hexColorRegex = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
var ipv4Regex = regexp.MustCompile(`^\d{1,3}(\.\d{1,3}){3}$`)

const (
	minWidth        = 1
	maxWidth        = 20
	maxStrokePoints = 1000
)

func ValidateStrokeContent(contentBytes []byte) error {
	var content strokeContent
	if err := json.Unmarshal(contentBytes, &content); err != nil {
		return errors.New("invalid content format")
	}

	if content.Tool < 0 || content.Tool >= ToolCount {
		return errors.New("invalid tool")
	}

	if !hexColorRegex.MatchString(content.Color) {
		return errors.New("invalid color")
	}

	if content.Width < minWidth || content.Width > maxWidth {
		return errors.New("invalid width")
	}

	if len(content.Dx) > maxStrokePoints || len(content.Dy) > maxStrokePoints {
		return errors.New("stroke too long")
	}

	return nil
}

func ValidatePageKey(pageKey string, isPrivate bool) error {
	if isPrivate {
		// Private keys are base64-encoded 32-byte HMACs
		decoded, err := base64.StdEncoding.DecodeString(pageKey)
		if err != nil {
			return errors.New("invalid private page key encoding")
		}
		if len(decoded) != 32 {
			return errors.New("invalid private page key length")
		}
		return nil
	}

	// Public keys: normalized URLs
	if strings.Contains(pageKey, "://") {
		return errors.New("public page key must not contain protocol")
	}
	if strings.HasPrefix(pageKey, "www.") {
		return errors.New("public page key must not start with www.")
	}
	if strings.ContainsAny(pageKey, "?#") {
		return errors.New("public page key must not contain query or fragment")
	}
	if strings.HasSuffix(pageKey, "/") {
		return errors.New("public page key must not have trailing slash")
	}

	// Parse as URL to check hostname/port validity
	// We prepend https:// to make it a valid URL for parsing
	u, err := url.Parse("https://" + pageKey)
	if err != nil {
		return errors.New("invalid public page key format")
	}
	if u.Port() != "" {
		return errors.New("public page key must not contain port")
	}

	hostname := u.Hostname()

	// Frontend parity checks:
	// 1. Must contain at least one dot (domain structure - blocks localhost)
	if !strings.Contains(hostname, ".") {
		return errors.New("public page key must contain a dot")
	}
	// 2. Must not contain colons (blocks IPv6)
	if strings.Contains(hostname, ":") {
		return errors.New("public page key must not contain colons")
	}
	// 3. Must not be an IP address (IPv4 regex)
	if ipv4Regex.MatchString(hostname) {
		return errors.New("public page key must not be an IP address")
	}

	return nil
}
