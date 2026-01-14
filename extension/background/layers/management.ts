import * as encryption from '../encryption';
import * as tabTracking from '../tabs/tracking';
import { sendWebSocketMessage } from '../websocket';
import { normalizePageUrl } from '../../shared/utils';
import { Layer } from '../../shared/types';
import { LayerMessageType, StateSyncMessageType } from '../../shared/messageTypes';

/**
 * Switch a tab from one layer to another
 * @param tabId The tab to switch
 * @param canonicalUrl The canonical URL of the page
 * @param newLayer The layer to switch to (Layer enum: 0 = public, 1 = private)
 * @param keyVersion The key version (only for private layer)
 * @param toolbarState Optional toolbar state to use (instead of reading from storage)
 */
export async function switchTabLayer(
  tabId: number,
  canonicalUrl: string,
  newLayer: Layer,
  keyVersion?: string,
  toolbarState?: any
): Promise<void> {
  const tab = await tabTracking.getTrackedTab(tabId);
  if (!tab) {
    console.log(`Tab ${tabId} not found in tracked tabs`);
    return;
  }

  const oldLayer = tab.layer;

  // If already on target layer, just send SWITCH_LAYER message to reload strokes
  if (oldLayer === newLayer) {
    // Calculate pageKey for current layer
    const normalizedUrl = normalizePageUrl(canonicalUrl);
    let pageKey: string;
    let layerId: string;

    if (newLayer === Layer.Private) {
      // Get DEK2 from session storage for HMAC
      const sessionData = await chrome.storage.session.get(['DEK2']);
      if (!sessionData.DEK2) {
        console.log('DEK2 not found in session storage, cannot reload private layer');
        return;
      }

      const DEK2 = encryption.base64ToUint8Array(sessionData.DEK2);
      const pageKeyBytes = encryption.computeHMACPageKey(DEK2, normalizedUrl);
      pageKey = encryption.uint8ArrayToBase64(pageKeyBytes);

      // Get keyVersion from user state
      const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');
      layerId = userState?.keyVersion?.toString() || '';
    } else {
      // Public layer uses normalized URL
      pageKey = normalizedUrl;
      layerId = '';
    }

    // Update trackedTab pageKey BEFORE sending SWITCH_LAYER
    // This ensures load_response can find the tab
    // For public layer, canonicalUrl should be the actual URL (not HMAC)
    await tabTracking.updateTrackedTabPage(tabId, pageKey, normalizedUrl);

    // Use provided toolbarState or fall back to fetching from storage
    let finalToolbarState = toolbarState;
    if (!finalToolbarState) {
      const updatedTab = await tabTracking.getTrackedTab(tabId);
      finalToolbarState = updatedTab?.toolbarState;
    }

    // Send message to content script to reload
    chrome.tabs.sendMessage(tabId, {
      type: LayerMessageType.SWITCH_LAYER,
      layer: newLayer,
      pageKey,
      layerId,
      toolbarState: finalToolbarState // Include toolbar state so it can be applied immediately
    }).catch(() => {
      console.log(`❓ Could not send SWITCH_LAYER message to tab ${tabId}`);
    });

    // Also notify toolbar to restore its state
    if (finalToolbarState) {
      chrome.tabs.sendMessage(tabId, {
        type: StateSyncMessageType.RESTORE_TOOLBAR_STATE,
        state: finalToolbarState
      }).catch(() => {
        console.log(`❓ Could not send RESTORE_TOOLBAR_STATE message to tab ${tabId}`);
      });
    }

    return;
  }

  // Unsubscribe from old layer/pageKey (only if no other tabs on this page/layer)
  const { shouldUnsubscribeFromPage } = await import('../tabs/tracking');
  const shouldUnsubscribe = await shouldUnsubscribeFromPage(tab.pageKey, tab.tabId, tab.layer);

  if (shouldUnsubscribe) {
    // Remove from local subscription tracking
    const { removeSubscription } = await import('../websocket/subscriptions');
    await removeSubscription(tab.pageKey, tab.layer, tab.layerId);

    // Send unsubscribe message to backend
    sendWebSocketMessage({
      type: 'unsubscribe',
      data: {
        pageKey: tab.pageKey,
        layer: tab.layer,
        layerId: tab.layerId
      }
    });
  }

  // Normalize the canonical URL
  const normalizedUrl = normalizePageUrl(canonicalUrl);

  // Calculate new pageKey
  let newPageKey: string;
  let newLayerId: string;

  if (newLayer === Layer.Private) {
    // Get DEK2 from session storage for HMAC
    const sessionData = await chrome.storage.session.get(['DEK2']);
    if (!sessionData.DEK2) {
      console.log('DEK2 not found in session storage, cannot switch to private layer');
      // Fall back to public layer
      newPageKey = normalizedUrl;
      newLayer = Layer.Public;
      newLayerId = '';
    } else {
      const DEK2 = encryption.base64ToUint8Array(sessionData.DEK2);
      const pageKeyBytes = encryption.computeHMACPageKey(DEK2, normalizedUrl);
      newPageKey = encryption.uint8ArrayToBase64(pageKeyBytes);

      // Get keyVersion from user state
      const userState = await chrome.storage.local.get('webverse_user_state');
      newLayerId = userState.webverse_user_state?.keyVersion?.toString() || '';
    }
  } else {
    // Public layer uses normalized URL
    newPageKey = normalizedUrl;
    newLayerId = '';
  }

  // Update tracked tab
  await tabTracking.updateTabLayer(tabId, newLayer, newLayerId);

  // Update pageKey and canonicalUrl in tracked tab
  // For public layer, canonicalUrl should be the actual URL (not HMAC)
  await tabTracking.updateTrackedTabPage(tabId, newPageKey, normalizedUrl);

  // Use provided toolbarState or fall back to fetching from storage
  let finalToolbarState = toolbarState;
  if (!finalToolbarState) {
    const updatedTab = await tabTracking.getTrackedTab(tabId);
    finalToolbarState = updatedTab?.toolbarState;
  }

  // Subscribe to new layer/pageKey
  // Add to local subscription tracking
  const { addSubscription } = await import('../websocket/subscriptions');
  await addSubscription(newPageKey, newLayer, newLayerId);

  // Send subscribe message to backend
  sendWebSocketMessage({
    type: 'subscribe',
    data: {
      pageKey: newPageKey,
      layer: newLayer, // Layer enum (0 or 1)
      layerId: newLayerId
    }
  });

  // Send message to content script to clear canvas and reload
  chrome.tabs.sendMessage(tabId, {
    type: LayerMessageType.SWITCH_LAYER,
    layer: newLayer, // Layer enum (0 or 1)
    pageKey: newPageKey,
    layerId: newLayerId,
    toolbarState: finalToolbarState // Include toolbar state so it can be applied immediately
  }).catch(() => {
    console.log(`❓ Could not send SWITCH_LAYER message to tab ${tabId}`);
  });

  // Also notify toolbar to restore its state
  if (finalToolbarState) {
    // Send to content script which will forward to toolbar via window.postMessage
    chrome.tabs.sendMessage(tabId, {
      type: StateSyncMessageType.RESTORE_TOOLBAR_STATE,
      state: finalToolbarState
    }).catch(() => {
      console.log(`❓ Could not send RESTORE_TOOLBAR_STATE message to tab ${tabId}`);
    });
  }
}

/**
 * Switch all private layer tabs to public layer
 * Called when user locks the private layer
 */
export async function switchAllPrivateToPublic(): Promise<void> {
  const privateTabs = await tabTracking.getPrivateLayerTabs();

  for (const tab of privateTabs) {
    try {
      // Get the tab's canonical URL
      const tabData = await chrome.tabs.get(tab.tabId);
      if (!tabData.url) continue;

      const canonicalUrl = normalizePageUrl(tabData.url);

      // Switch to public layer
      await switchTabLayer(tab.tabId, canonicalUrl, Layer.Public);
    } catch (error) {
      console.log(`Failed to switch tab ${tab.tabId} to public:`, error);
    }
  }
}
