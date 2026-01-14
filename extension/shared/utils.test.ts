import { describe, it, expect } from 'vitest';
import { normalizePageUrl, isValidPage } from './utils';

describe('normalizePageUrl', () => {
  describe('basic URL normalization', () => {
    it('should remove www prefix', () => {
      expect(normalizePageUrl('https://www.example.com/page')).toBe('example.com/page');
      expect(normalizePageUrl('http://www.example.com')).toBe('example.com');
    });

    it('should remove protocol', () => {
      expect(normalizePageUrl('https://example.com/page')).toBe('example.com/page');
      expect(normalizePageUrl('http://example.com/page')).toBe('example.com/page');
    });

    it('should remove query parameters', () => {
      expect(normalizePageUrl('https://example.com/page?foo=bar&baz=qux')).toBe('example.com/page');
      expect(normalizePageUrl('https://www.example.com/?id=123')).toBe('example.com');
    });

    it('should remove hash fragments', () => {
      expect(normalizePageUrl('https://example.com/page#section')).toBe('example.com/page');
      expect(normalizePageUrl('https://www.example.com#top')).toBe('example.com');
    });

    it('should remove trailing slash', () => {
      expect(normalizePageUrl('https://www.example.com/page/')).toBe('example.com/page');
      expect(normalizePageUrl('https://example.com/')).toBe('example.com');
    });

    it('should preserve pathname', () => {
      expect(normalizePageUrl('https://www.example.com/path/to/page')).toBe('example.com/path/to/page');
    });
  });

  describe('edge cases', () => {
    it('should handle URLs without path (root)', () => {
      expect(normalizePageUrl('https://www.example.com')).toBe('example.com');
      expect(normalizePageUrl('http://example.com')).toBe('example.com');
    });

    it('should handle root path', () => {
      expect(normalizePageUrl('https://www.example.com/')).toBe('example.com');
    });

    it('should return original URL if invalid', () => {
      const invalidUrl = 'not-a-valid-url';
      expect(normalizePageUrl(invalidUrl)).toBe(invalidUrl);
    });

    it('should handle complex paths', () => {
      expect(normalizePageUrl('https://www.example.com/path/to/page/')).toBe('example.com/path/to/page');
      expect(normalizePageUrl('https://example.com/path/to/page.html?query=value#hash')).toBe('example.com/path/to/page.html');
    });

    it('should preserve multiple path segments', () => {
      expect(normalizePageUrl('https://www.example.com/a/b/c')).toBe('example.com/a/b/c');
    });
  });
});

describe('isValidPage', () => {
  describe('valid pages', () => {
    it('should accept https URLs with domain', () => {
      const url = new URL('https://example.com');
      expect(isValidPage(url)).toBe(true);
    });

    it('should accept http URLs with domain', () => {
      const url = new URL('http://example.com');
      expect(isValidPage(url)).toBe(true);
    });

    it('should accept URLs with www prefix', () => {
      const url = new URL('https://www.example.com');
      expect(isValidPage(url)).toBe(true);
    });

    it('should accept subdomains', () => {
      const url = new URL('https://blog.example.com');
      expect(isValidPage(url)).toBe(true);
    });

    it('should accept URLs with paths', () => {
      const url = new URL('https://example.com/page');
      expect(isValidPage(url)).toBe(true);
    });

    it('should accept multi-part domains', () => {
      const url = new URL('https://example.co.uk');
      expect(isValidPage(url)).toBe(true);
    });
  });

  describe('invalid pages', () => {
    it('should reject non-http protocols', () => {
      expect(isValidPage(new URL('file:///path/to/file'))).toBe(false);
      expect(isValidPage(new URL('chrome://extensions'))).toBe(false);
      expect(isValidPage(new URL('chrome-extension://abc123/popup.html'))).toBe(false);
      expect(isValidPage(new URL('ftp://example.com'))).toBe(false);
      expect(isValidPage(new URL('mailto:test@example.com'))).toBe(false);
    });

    it('should reject localhost', () => {
      const url = new URL('http://localhost:3000');
      expect(isValidPage(url)).toBe(false);
    });

    it('should reject IP addresses', () => {
      expect(isValidPage(new URL('http://192.168.1.1'))).toBe(false);
      expect(isValidPage(new URL('https://127.0.0.1'))).toBe(false);
      expect(isValidPage(new URL('http://10.0.0.1'))).toBe(false);
    });

    it('should reject IPv6 addresses (contain colons)', () => {
      const url = new URL('http://[::1]');
      expect(isValidPage(url)).toBe(false);
    });

    it('should reject domains without dots', () => {
      const url = new URL('http://example');
      expect(isValidPage(url)).toBe(false);
    });

    it('should reject Chrome extension pages', () => {
      const url = new URL('chrome-extension://abcdefgh/popup.html');
      expect(isValidPage(url)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle URLs with ports', () => {
      const url = new URL('https://example.com:8080');
      expect(isValidPage(url)).toBe(true);
    });

    it('should handle international domains', () => {
      const url = new URL('https://example.中国');
      expect(isValidPage(url)).toBe(true);
    });

    it('should handle domains with subdomains', () => {
      const url = new URL('https://sub.blog.example.com');
      expect(isValidPage(url)).toBe(true);
    });
  });
});
