import { TrackedTab } from '../types';
import { Layer, Tool } from '../../shared/types';
import { sendWebSocketMessage } from '../websocket';

// Tab management functions
export async function getTrackedTabs(): Promise<Map<number, TrackedTab>> {
  const { trackedTabs: tabsData = {} } = await chrome.storage.session.get('trackedTabs');
  return new Map(Object.entries(tabsData).map(([id, tab]: [string, any]) => [parseInt(id), tab]));
}

export async function setTrackedTabs(tabs: Map<number, TrackedTab>): Promise<void> {
  const obj = Object.fromEntries(tabs.entries());
  await chrome.storage.session.set({ trackedTabs: obj });
}

export async function addTrackedTab(tabId: number, pageKey: string, layer: Layer = Layer.Public, layerId: string = ''): Promise<void> {
  const tabs = await getTrackedTabs();
  tabs.set(tabId, { tabId, pageKey, canonicalUrl: pageKey, layer, layerId, hasLaunchedForCurrentUrl: false });
  await setTrackedTabs(tabs);
}

export async function removeTrackedTab(tabId: number): Promise<TrackedTab | undefined> {
  const tabs = await getTrackedTabs();
  const tab = tabs.get(tabId);
  if (tab) {
    tabs.delete(tabId);
    await setTrackedTabs(tabs);
  }
  return tab;
}

export async function getTrackedTab(tabId: number): Promise<TrackedTab | undefined> {
  const tabs = await getTrackedTabs();
  return tabs.get(tabId);
}

export async function updateTrackedTabPage(tabId: number, pageKey: string, canonicalUrl?: string): Promise<void> {
  const tabs = await getTrackedTabs();
  const existing = tabs.get(tabId);
  if (existing) {
    // Check if pageKey is actually changing (navigation)
    const oldPageKey = existing.pageKey;
    const isNavigating = oldPageKey !== pageKey;

    if (isNavigating) {
      // Unsubscribe from old page before updating
      await maybeUnsubscribeFromPage(oldPageKey, tabId);
    }

    // Update both pageKey and canonicalUrl
    // For Private layer: pageKey is the HMAC, canonicalUrl is the normalized URL
    // For Public layer: pageKey = canonicalUrl (both are the normalized URL)
    tabs.set(tabId, {
      tabId,
      pageKey,
      canonicalUrl: canonicalUrl || pageKey,
      layer: existing.layer,
      layerId: existing.layerId,
      hasLaunchedForCurrentUrl: false,
      toolbarState: existing.toolbarState
    });
    await setTrackedTabs(tabs);
  }
}

// Find all tabs on a specific page
export async function getTabsOnPage(pageKey: string): Promise<number[]> {
  const tabs = await getTrackedTabs();
  return Array.from(tabs.values())
    .filter(tab => tab.pageKey === pageKey)
    .map(tab => tab.tabId);
}

// Check if we should unsubscribe from a page (only if no other tabs are subscribed)
export async function shouldUnsubscribeFromPage(pageKey: string, excludingTabId?: number, layer?: Layer): Promise<boolean> {
  const tabs = await getTrackedTabs();
  const tabsOnPage = Array.from(tabs.values())
    .filter(tab => tab.pageKey === pageKey && (excludingTabId === undefined || tab.tabId !== excludingTabId));

  // If checking for a specific layer, also filter by layer
  if (layer !== undefined) {
    const tabsOnSameLayer = tabsOnPage.filter(tab => tab.layer === layer);
    return tabsOnSameLayer.length === 0;
  }

  return tabsOnPage.length === 0;
}

// Unsubscribe from a page if this is the last tab on that page (for the specific layer)
export async function maybeUnsubscribeFromPage(pageKey: string, excludingTabId: number): Promise<void> {
  // Get layer from the tab being removed (before it's removed from tracking)
  const tabs = await getTrackedTabs();
  const tabBeingRemoved = tabs.get(excludingTabId);
  if (!tabBeingRemoved) return;

  const layer = tabBeingRemoved.layer;
  const layerId = tabBeingRemoved.layerId;

  const shouldUnsubscribe = await shouldUnsubscribeFromPage(pageKey, excludingTabId, layer);

  if (shouldUnsubscribe) {
    // Remove from subscription tracking
    const { removeSubscription } = await import('../websocket/subscriptions');
    await removeSubscription(pageKey, layer, layerId);

    // Send unsubscribe message to backend
    sendWebSocketMessage({
      type: 'unsubscribe',
      data: {
        pageKey,
        layer,
        layerId
      }
    });
  }
}

// Update the layer for a specific tab
export async function updateTabLayer(tabId: number, layer: Layer, layerId: string): Promise<void> {
  const tabs = await getTrackedTabs();
  const tab = tabs.get(tabId);
  if (tab) {
    tab.layer = layer;
    tab.layerId = layerId;
    // Also update toolbar state to keep in sync
    if (tab.toolbarState) {
      tab.toolbarState.layer = layer;
    }
    await setTrackedTabs(tabs);
  }
}

// Get all tabs on private layer
export async function getPrivateLayerTabs(): Promise<TrackedTab[]> {
  const tabs = await getTrackedTabs();
  return Array.from(tabs.values()).filter(tab => tab.layer === Layer.Private);
}

// Update toolbar state for a specific tab
export async function updateToolbarState(
  tabId: number,
  toolbarState: {
    layer: number;
    showMineOnly: boolean;
    tool: Tool | null;
    color: string;
    width: number;
    position?: { x: number; y: number };
  }
): Promise<void> {
  const tabs = await getTrackedTabs();
  const tab = tabs.get(tabId);
  if (tab) {
    tab.toolbarState = toolbarState;
    await setTrackedTabs(tabs);
  }
}

export async function markLaunchedForCurrentUrl(tabId: number): Promise<void> {
  const tabs = await getTrackedTabs();
  const tab = tabs.get(tabId);
  if (tab) {
    tab.hasLaunchedForCurrentUrl = true;
    await setTrackedTabs(tabs);
  }
}

// Set toolbar active status and manage WebSocket connection
export async function setToolbarActive(tabId: number, active: boolean): Promise<void> {
  const tabs = await getTrackedTabs();
  const tab = tabs.get(tabId);
  if (tab) {
    tab.isToolbarActive = active;
    await setTrackedTabs(tabs);

    if (active) {
      // Toolbar is opening - connect WebSocket if this is the first one
      await connectWebSocketIfNeeded();

      // Start keep-alive alarm to prevent service worker from going dormant
      const { startKeepAlive } = await import('../index');
      await startKeepAlive();
    } else {
      // Toolbar is closing - disconnect WebSocket if this was the last one
      await disconnectWebSocketIfNeeded();

      // Stop keep-alive alarm if this was the last toolbar
      const activeCount = Array.from(tabs.values()).filter(t => t.isToolbarActive).length;
      if (activeCount === 0) {
        const { stopKeepAlive } = await import('../index');
        await stopKeepAlive();
      }
    }
  }
}

// Get count of active toolbars
export async function getActiveToolbarCount(): Promise<number> {
  const tabs = await getTrackedTabs();
  return Array.from(tabs.values()).filter(tab => tab.isToolbarActive).length;
}

// Connect WebSocket if needed (when first toolbar opens)
async function connectWebSocketIfNeeded(): Promise<void> {
  const { connectWebSocket, isWebSocketConnected } = await import('../websocket');
  if (!isWebSocketConnected()) {
    await connectWebSocket();
  }
}

// Disconnect WebSocket if needed (when last toolbar closes)
async function disconnectWebSocketIfNeeded(): Promise<void> {
  const activeCount = await getActiveToolbarCount();
  if (activeCount === 0) {
    const { disconnectWebSocket } = await import('../websocket');
    disconnectWebSocket();
  }
}

