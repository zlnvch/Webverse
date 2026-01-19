import { normalizePageUrl } from '@shared/utils';
import { TabLifecycleMessageType } from '@shared/messageTypes';

/**
 * URL Change Detector for SPA Navigation
 *
 * Single Page Applications (SPAs) don't trigger chrome.tabs.onUpdated events
 * when the URL changes via History API (pushState/replaceState).
 *
 * This detector polls the URL every 100ms and notifies the background when
 * a change is detected. The background then handles re-subscription and
 * re-launch of the drawing engine with the correct page context.
 */

interface URLChangeDetectorOptions {
  /** Polling interval in milliseconds (default: 100ms) */
  interval?: number;
  /** Callback when URL change is detected */
  onURLChange?: (oldUrl: string, newUrl: string) => void;
}

export class URLChangeDetector {
  private pollIntervalId: number | null = null;
  private lastNormalizedUrl: string;
  private readonly interval: number;

  constructor(private options: URLChangeDetectorOptions = {}) {
    this.interval = options.interval ?? 100;
    this.lastNormalizedUrl = normalizePageUrl(window.location.href);
  }

  /**
   * Start polling for URL changes
   */
  start(): void {
    // Don't start multiple timers
    if (this.pollIntervalId !== null) {
      return;
    }

    this.pollIntervalId = window.setInterval(() => {
      this.checkURLChange();
    }, this.interval);
  }

  /**
   * Stop polling for URL changes
   */
  stop(): void {
    if (this.pollIntervalId !== null) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  /**
   * Check if URL has changed and notify background
   */
  private checkURLChange(): void {
    const currentUrl = window.location.href;
    const normalizedUrl = normalizePageUrl(currentUrl);

    // Only proceed if the normalized URL has changed
    if (normalizedUrl !== this.lastNormalizedUrl) {
      const oldUrl = this.lastNormalizedUrl;
      this.lastNormalizedUrl = normalizedUrl;

      // Notify callback if provided
      if (this.options.onURLChange) {
        this.options.onURLChange(oldUrl, normalizedUrl);
      }

      // Notify background script
      this.notifyBackground(oldUrl, normalizedUrl);
    }
  }

  /**
   * Notify background script of URL change
   */
  private notifyBackground(oldUrl: string, newUrl: string): void {
    chrome.runtime.sendMessage({
      type: TabLifecycleMessageType.SPA_URL_CHANGED,
      oldUrl,
      newUrl,
      pageKey: newUrl
    }).catch(() => {
      // Silently suppress errors - background may not be ready or extension context invalid
      // This can happen during page unload or extension reload
    });
  }

  /**
   * Get the current normalized URL being tracked
   */
  getCurrentUrl(): string {
    return this.lastNormalizedUrl;
  }

  /**
   * Update the tracked URL (useful after manual URL changes)
   */
  updateUrl(url: string): void {
    this.lastNormalizedUrl = normalizePageUrl(url);
  }
}
