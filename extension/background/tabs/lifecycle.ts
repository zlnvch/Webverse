import { normalizePageUrl, isValidPage } from '../../shared/utils';
import * as tabTracking from './tracking';
import * as encryption from '../encryption';
import * as websocket from '../websocket';
import {
  TabLifecycleMessageType,
  StateSyncMessageType,
  LayerMessageType,
  WebSocketMessageType
} from '../../shared/messageTypes';

// Setup tab event listeners
export function setupTabEventListeners() {
  // Tab updated listener
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only proceed if the page has finished loading
    if (changeInfo.status !== 'complete' || !tab.url) {
      return;
    }

    // Check if this is a tracked tab
    const trackedTab = await tabTracking.getTrackedTab(tabId);
    if (!trackedTab) {
      return; // Not our tab
    }

    // Skip if this is the initial launch (GET_TAB_ID handler will take care of it)
    // We know it's the initial launch if hasLaunchedForCurrentUrl is not set
    if (!trackedTab.hasLaunchedForCurrentUrl) {
      // Mark that we've now handled this tab
      await tabTracking.markLaunchedForCurrentUrl(tabId);
      return;
    }

    // Check if the new URL is a valid page for Webverse
    let urlObj: URL;
    try {
      urlObj = new URL(tab.url);
    } catch {
      return;
    }

    // Check if this is a valid page for Webverse (http/https, not IP, not localhost)
    if (!isValidPage(urlObj)) {
      return;
    }

    // Normalize the new page key
    const newPageKey = normalizePageUrl(tab.url);

    // Check if page actually changed
    if (newPageKey === trackedTab.pageKey) {
      return; // Same page
    }

    // Unsubscribe from old page if this is the last tab on that page
    await tabTracking.maybeUnsubscribeFromPage(trackedTab.pageKey, tabId);

    // For Private layer, compute HMAC pageKey before updating tracked tab
    let pageKeyForTracking = newPageKey;
    if (trackedTab.layer === 1 && trackedTab.layerId) {
      const { DEK2 } = await chrome.storage.session.get('DEK2');
      if (DEK2) {
        const DEK2Bytes = encryption.base64ToUint8Array(DEK2);
        const pageKeyBytes = encryption.computeHMACPageKey(DEK2Bytes, newPageKey);
        pageKeyForTracking = encryption.uint8ArrayToBase64(pageKeyBytes);
      }
    }

    // Update tracked tab with new page key (HMAC for private layer, normalized URL for public)
    await tabTracking.updateTrackedTabPage(tabId, pageKeyForTracking);

    // Get toolbar state from trackedTabs
    const trackedTabData = await tabTracking.getTrackedTab(tabId);
    const toolbarState = trackedTabData?.toolbarState || null;

    // Send message to content script to re-launch toolbar on the new page with toolbar state
    chrome.tabs.sendMessage(tabId, {
      type: TabLifecycleMessageType.RELAUNCH_WEBVERSE_ON_NAVIGATION,
      toolbarState,
      pageKey: pageKeyForTracking,  // Use the HMAC (or normalized URL for public)
      layer: trackedTab.layer,
      layerId: trackedTab.layerId
    }).catch(() => {
      console.log(`❓ Could not send re-launch message to tab ${tabId}`);
    });
  });

  // Tab removed listener
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    // Check if this is a tracked tab
    const trackedTab = await tabTracking.getTrackedTab(tabId);
    if (trackedTab) {
      // Store whether this was the last active toolbar BEFORE removing the tab
      const wasLastActiveToolbar = trackedTab.isToolbarActive && (await tabTracking.getActiveToolbarCount() === 1);

      // Unsubscribe from the page BEFORE removing the tab (so we have the layer info)
      await tabTracking.maybeUnsubscribeFromPage(trackedTab.pageKey, tabId, trackedTab.layer, trackedTab.layerId);

      // Remove from tracked tabs
      await tabTracking.removeTrackedTab(tabId);

      // Disconnect WebSocket if this was the last active toolbar
      if (wasLastActiveToolbar) {
        const { disconnectWebSocket } = await import('../websocket');
        disconnectWebSocket();
      }
    }

    // Tab will be removed from trackedTabs by removeTrackedTab above
    // No need for separate launchedTabs tracking
  });
}

// Handle get tab ID request from content script
export async function handleGetTabId(message: any, sender: any, sendResponse: (response?: any) => void) {
  const tabId = sender.tab?.id;
  if (tabId) {
    // Check if this tab should auto-launch (exists in trackedTabs)
    const trackedTab = await tabTracking.getTrackedTab(tabId);

    if (trackedTab) {
      // Tab exists in trackedTabs, so it should auto-launch
      const toolbarState = trackedTab.toolbarState || null;
      const savedLayer = trackedTab.layer ?? 0;
      const savedLayerId = trackedTab.layerId || '';

      // Compute pageKey from current URL (not from saved trackedTab.pageKey)
      // This ensures back/forward navigation loads correct strokes for current URL
      let computedPageKey: string | null = null;
      const currentTab = await chrome.tabs.get(tabId);
      if (currentTab.url) {
        // Check if the current URL is valid for Webverse
        let urlObj: URL;
        try {
          urlObj = new URL(currentTab.url);
        } catch {
          return true;
        }

        if (!isValidPage(urlObj)) {
          return true;
        }

        const normalizedUrl = normalizePageUrl(currentTab.url);

        if (savedLayer === 1 && savedLayerId) {
          // Private layer: compute HMAC from current URL
          const sessionData = await chrome.storage.session.get(['DEK2']);
          if (sessionData.DEK2) {
            const DEK2Bytes = encryption.base64ToUint8Array(sessionData.DEK2);
            const pageKeyBytes = encryption.computeHMACPageKey(DEK2Bytes, normalizedUrl);
            computedPageKey = encryption.uint8ArrayToBase64(pageKeyBytes);
          } else {
            computedPageKey = normalizedUrl;
          }
        } else {
          // Public layer: use normalized URL
          computedPageKey = normalizedUrl;
        }
      }

      // Update trackedTab.pageKey to match current URL (prevents unnecessary relaunch in tab.onUpdated)
      if (computedPageKey && trackedTab.pageKey !== computedPageKey) {
        await tabTracking.updateTrackedTabPage(tabId, computedPageKey);
      }

      chrome.tabs.sendMessage(tabId, {
        type: TabLifecycleMessageType.YOUR_TAB_ID,
        tabId,
        toolbarState,
        pageKey: computedPageKey,
        layer: savedLayer,
        layerId: savedLayerId
      }).catch(() => {
        // Tab might have been closed
      });
    }
  }

  return true;
}

// Handle get tab ID request from toolbar (for state persistence)
export async function handleGetTabIdForToolbar(message: any, sender: any, sendResponse: (response?: any) => void) {
  const tabId = sender.tab?.id;
  sendResponse({ tabId });
  return true;
}

// Handle content script ready message
export async function handleContentScriptReady(message: any, sender: any, sendResponse: (response?: any) => void) {
  // Use sender.tab.id instead of relying on the content script to tell us its tab ID
  const tabId = sender.tab?.id;
  const { pageKey } = message;

  if (!tabId) {
    sendResponse({ success: false });
    return true;
  }

  // Check if the tab URL is valid for Webverse
  const tabUrl = sender.tab?.url;
  if (!tabUrl) {
    sendResponse({ success: false });
    return true;
  }

  let urlObj: URL;
  try {
    urlObj = new URL(tabUrl);
  } catch {
    sendResponse({ success: false });
    return true;
  }

  if (!isValidPage(urlObj)) {
    sendResponse({ success: false });
    return true;
  }

  // Check if tab already exists (e.g., after refresh)
  const existingTab = await tabTracking.getTrackedTab(tabId);

  if (existingTab) {
    // Tab is being refreshed/relaunched - keep the existing tracked info
  } else {
    // New tab - track it with Public layer by default
    await tabTracking.addTrackedTab(tabId, pageKey);
  }

  sendResponse({ success: true });
  return true;
}

// Handle toolbar opened - mark toolbar as active and connect WebSocket if needed
export async function handleToolbarOpened(message: any, sender: any, sendResponse: (response?: any) => void) {
  const tabId = sender.tab?.id;
  if (tabId) {
    const trackedTab = await tabTracking.getTrackedTab(tabId);
    if (trackedTab) {
      // Mark toolbar as active (will connect WebSocket if this is the first toolbar)
      await tabTracking.setToolbarActive(tabId, true);

      // If WebSocket is already connected, notify this tab immediately
      if (websocket.isWebSocketConnected()) {
        chrome.tabs.sendMessage(tabId, { type: WebSocketMessageType.WEBSOCKET_CONNECTED }).catch(() => {
          // Tab might have been closed
        });
      }
    }
  }
  sendResponse({ success: true });
  return true;
}

// Handle toolbar closed - mark toolbar as inactive and disconnect WebSocket if last one
export async function handleToolbarClosed(message: any, sender: any, sendResponse: (response?: any) => void) {
  const tabId = sender.tab?.id;
  if (tabId) {
    const trackedTab = await tabTracking.getTrackedTab(tabId);
    if (trackedTab) {
      // Mark toolbar as inactive (will disconnect WebSocket if this was the last toolbar)
      await tabTracking.setToolbarActive(tabId, false);

      // Unsubscribe from the page only if this is the last tab on that page
      await tabTracking.maybeUnsubscribeFromPage(trackedTab.pageKey, tabId, trackedTab.layer, trackedTab.layerId);

      // Remove from tracked tabs (tab stays open, just Webverse is closed)
      await tabTracking.removeTrackedTab(tabId);
    }
  }
  sendResponse({ success: true });
  return true;
}

// Handle save toolbar state request (from toolbar)
export async function handleSaveToolbarState(message: any, sender: any, sendResponse: (response?: any) => void) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) {
      console.log('❌ SAVE_TOOLBAR_STATE: No tab ID in sender');
      sendResponse({ success: false, error: 'No tab ID' });
      return true;
    }

    const { state } = message;
    console.log(`💾 SAVE_TOOLBAR_STATE received for tab ${tabId}:`, state);

    // Save to trackingTabs (this persists to chrome.storage.session)
    await tabTracking.updateToolbarState(tabId, state);

    sendResponse({ success: true });
  } catch (error) {
    console.log('❌ Save toolbar state failed:', error);
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to save toolbar state' });
  }
  return true;
}

// Handle get tab key version request (for encrypting strokes)
export async function handleGetTabKeyVersion(message: any, sender: any, sendResponse: (response?: any) => void) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return true;
    }

    const trackedTab = await tabTracking.getTrackedTab(tabId);
    if (!trackedTab) {
      sendResponse({ success: false, error: 'Tab not tracked' });
      return true;
    }

    // Return the layerId (keyVersion) for this tab
    sendResponse({ success: true, keyVersion: trackedTab.layerId });
  } catch (error) {
    console.log('❌ Get tab key version failed:', error);
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to get key version' });
  }
  return true;
}

// Handle SPA URL change detected by content script polling
export async function handleSPAUrlChanged(message: any, sender: any, sendResponse: (response?: any) => void) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ success: false });
    return true;
  }

  const { oldUrl, newUrl, pageKey } = message;

  // Check if this is a tracked tab
  const trackedTab = await tabTracking.getTrackedTab(tabId);
  if (!trackedTab) {
    sendResponse({ success: false });
    return true;
  }

  // Double-check that the page has actually changed
  // (onUpdated might have already handled it, or this could be a duplicate)
  if (newUrl === trackedTab.pageKey) {
    sendResponse({ success: true, alreadyHandled: true });
    return true;
  }

  // Unsubscribe from old page if this is the last tab on that page
  await tabTracking.maybeUnsubscribeFromPage(trackedTab.pageKey, tabId);

  // For Private layer, compute HMAC pageKey before updating tracked tab
  let pageKeyForTracking = newUrl;
  if (trackedTab.layer === 1 && trackedTab.layerId) {
    const { DEK2 } = await chrome.storage.session.get('DEK2');
    if (DEK2) {
      const DEK2Bytes = encryption.base64ToUint8Array(DEK2);
      const pageKeyBytes = encryption.computeHMACPageKey(DEK2Bytes, newUrl);
      pageKeyForTracking = encryption.uint8ArrayToBase64(pageKeyBytes);
    }
  }

  // Update tracked tab with new page key (HMAC for private layer, normalized URL for public)
  await tabTracking.updateTrackedTabPage(tabId, pageKeyForTracking);

  // Get toolbar state from trackedTabs
  const trackedTabData = await tabTracking.getTrackedTab(tabId);
  const toolbarState = trackedTabData?.toolbarState || null;

  // Send message to content script to re-launch toolbar on the new page with toolbar state
  chrome.tabs.sendMessage(tabId, {
    type: TabLifecycleMessageType.RELAUNCH_WEBVERSE_ON_NAVIGATION,
    toolbarState,
    pageKey: pageKeyForTracking,  // Use the HMAC (or normalized URL for public)
    layer: trackedTab.layer,
    layerId: trackedTab.layerId
  }).catch(() => {
    // Tab might have been closed or navigated away
  });

  sendResponse({ success: true });
  return true;
}
