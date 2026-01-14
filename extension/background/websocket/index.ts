import { getTrackedTabs, getTabsOnPage, getActiveToolbarCount } from '../tabs/tracking';
import { handleWebSocketResponse } from './handlers';
import { WS_BASE_URL } from '../../shared/constants';
import { WebSocketMessageType, UserMessageType } from '../../shared/messageTypes';

// WebSocket connection state
let ws: WebSocket | null = null;
let isWsAuthenticated = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

// Pending requests that haven't received responses yet
const pendingRequests = new Map<string, {
  message: any;
  timeout: NodeJS.Timeout;
  retryCount: number;
  tabId?: number; // Track which tab sent this request (for load requests)
}>();

// Generate a unique key for a request
function getRequestKey(message: any): string {
  return `${message.type}_${JSON.stringify(message.data)}`;
}

// Retry timeout and max retries
const RETRY_TIMEOUT = 1000; // 1 second
const MAX_RETRIES = 3;

// Exponential backoff parameters
const INITIAL_RECONNECT_DELAY = 500; // 500 ms
const BACKOFF_FACTOR = 2;
const MAX_RECONNECT_DELAY = 45000; // 45 seconds
const JITTER_PERCENT = 0.25; // ±25%

// Calculate delay with exponential backoff and jitter
function calculateReconnectDelay(attempt: number): number {
  // Exponential backoff: initial * factor^attempt
  const exponentialDelay = INITIAL_RECONNECT_DELAY * Math.pow(BACKOFF_FACTOR, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY);

  // Add jitter: ±JITTER_PERCENT
  const jitter = cappedDelay * JITTER_PERCENT * (Math.random() * 2 - 1);

  return Math.max(0, Math.floor(cappedDelay + jitter));
}

// WebSocket connection management
export async function connectWebSocket() {
  // If WebSocket exists and is authenticated, don't reconnect
  if (ws && ws.readyState === WebSocket.OPEN && isWsAuthenticated) {
    console.log('✅ WebSocket already connected and authenticated');
    return;
  }

  // If WebSocket exists but is not authenticated, close it first
  if (ws) {
    console.log('🔌 Closing existing unauthenticated WebSocket before reconnecting');
    ws.close();
    ws = null;
    isWsAuthenticated = false;
  }

  console.log('🔄 Background connecting to WebSocket...');

  // Get user credentials for authentication
  const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');

  if (!userState || !userState.isLoggedIn || !userState.id || !userState.token) {
    console.warn('⚠️ No user credentials available - cannot connect WebSocket');
    return;
  }

  // Build WebSocket URL with auth query params
  const wsUrl = `${WS_BASE_URL}/ws`;
  console.log('🔍 Attempting connection to:', wsUrl);

  try {
    // Send the userId and token in the Sec-WebSocket-Protocol header
    // The Sec-WebSocket-Protocol is currently the only handshake header that can be set in the browser's WebSocket API
    // Safer than using query params — less likely to get logged
    // Simpler and cheaper for server to defend against DoS attacks by checking auth before upgrading connection to WS
    // rather than waiting for an auth message after the connection has already been upgraded
    // https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-WebSocket-Protocol
    ws = new WebSocket(wsUrl, ["webverse-v1", userState.token]);

    ws.onopen = async () => {
      console.log('✅ Background WebSocket connected and authenticated');
      reconnectAttempts = 0; // Reset attempt counter on successful connection
      isWsAuthenticated = true;

      // Clear any pending requests from before the reconnect
      for (const [key, pending] of pendingRequests.entries()) {
        clearTimeout(pending.timeout);
      }
      pendingRequests.clear();

      // Resubscribe to all previous subscriptions
      const { getAllSubscriptions } = await import('./subscriptions');
      const previousSubscriptions = await getAllSubscriptions();

      for (const sub of previousSubscriptions) {
        sendWebSocketMessage({
          type: 'subscribe',
          data: {
            pageKey: sub.pageKey,
            layer: sub.layer,
            layerId: sub.layerId
          }
        });
      }

      // Get tracked tabs to notify about WebSocket connection
      const tabs = await getTrackedTabs();
      const tabIds = Array.from(tabs.keys());

      // Notify all tabs that WebSocket is connected (they will handle subscribing themselves)
      for (const tabId of tabIds) {
        chrome.tabs.sendMessage(tabId, { type: WebSocketMessageType.WEBSOCKET_CONNECTED }).catch(() => {
          // Tab might have been closed
        });
      }
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        // Handle all response messages
        if (message.type && message.type.endsWith('_response')) {
          // Clear pending request for this response
          const responseType = message.type.replace('_response', '');
          if (responseType === 'load' && message.data) {
            const requestKey = getRequestKey({
              type: responseType,
              data: {
                pageKey: message.data.pageKey,
                layer: message.data.layer,
                layerId: message.data.layerId
              }
            });
            const pending = pendingRequests.get(requestKey);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingRequests.delete(requestKey);
            }
          }

          await handleWebSocketResponse(message);
          return;
        }

        // Handle new_stroke push message
        if (message.type === 'new_stroke') {
          const { handleNewStroke } = await import('./handlers');
          await handleNewStroke(message);
          return;
        }

        // Handle delete_stroke push message
        if (message.type === 'delete_stroke') {
          const { handleDeleteStroke } = await import('./handlers');
          await handleDeleteStroke(message);
          return;
        }

        // Handle keys_updated push message
        if (message.type === 'keys_updated') {
          const { handleKeysUpdated } = await import('./handlers');
          await handleKeysUpdated(message);
          return;
        }
      } catch (error) {
        console.log('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = async (event) => {
      console.log('❌ Background WebSocket disconnected:', event.code, event.reason);
      ws = null;
      isWsAuthenticated = false;

      // Don't clear subscriptions - we'll resubscribe on reconnect

      // Check if disconnected due to authentication failure
      // Unauthenticated close is event code 1008 (Policy Violation)
      const isAuthFailure = event.code === 1008

      if (isAuthFailure) {
        console.log('❌ WebSocket authentication failed - logging out user');

        // Clear user state
        await chrome.storage.local.remove('webverse_user_state');

        // Notify all tabs to logout
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: UserMessageType.LOGOUT_USER }).catch(() => {});
          }
        }

        reconnectAttempts = 0;
        return;
      }

      // Notify all tracked tabs that WebSocket is disconnected
      const trackedTabs = await getTrackedTabs();
      for (const tabId of trackedTabs.keys()) {
        chrome.tabs.sendMessage(tabId, { type: WebSocketMessageType.WEBSOCKET_DISCONNECTED }).catch(() => {
          console.log(`❓ Could not notify tab ${tabId} about WebSocket disconnection`);
        });
      }

      // Check if user is logged in before attempting to reconnect
      const result = await chrome.storage.local.get('webverse_user_state');
      const userState = result.webverse_user_state;

      if (!userState || !userState.isLoggedIn || !userState.token) {
        console.log('ℹ️ User not logged in - skipping WebSocket reconnect');
        reconnectAttempts = 0;
        return;
      }

      // Check if there are any active toolbars before reconnecting
      const activeToolbarCount = await getActiveToolbarCount();
      if (activeToolbarCount === 0) {
        console.log('ℹ️ No active toolbars - skipping WebSocket reconnect');
        reconnectAttempts = 0;
        return;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = calculateReconnectDelay(reconnectAttempts);
      reconnectAttempts++;

      console.log(`🔄 Scheduling WebSocket reconnect in ${delay}ms (attempt ${reconnectAttempts})`);

      reconnectTimer = setTimeout(() => {
        connectWebSocket();
      }, delay);
    };

    ws.onerror = (error) => {
      console.log('ℹ️ Background WebSocket error:', error);
    };

  } catch (error) {
    console.log('ℹ️ Failed to create background WebSocket connection:', error);
  }
}

// Send message via WebSocket
export function sendWebSocketMessage(message: any, tabId?: number): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const messageStr = JSON.stringify(message);
    ws.send(messageStr);

    // Track load requests for retry if no response
    if (message.type === 'load') {
      const requestKey = getRequestKey(message);

      // Clear any existing timeout for this request
      const existing = pendingRequests.get(requestKey);
      if (existing) {
        clearTimeout(existing.timeout);
      }

      // Set timeout to retry if no response
      const timeout = setTimeout(() => {
        const pending = pendingRequests.get(requestKey);
        if (pending) {
          if (pending.retryCount < MAX_RETRIES) {
            pending.retryCount++;
            pending.timeout = timeout;
            sendWebSocketMessage(message, pending.tabId);
          } else {
            pendingRequests.delete(requestKey);
          }
        }
      }, RETRY_TIMEOUT);

      pendingRequests.set(requestKey, {
        message,
        timeout,
        retryCount: existing?.retryCount || 0,
        tabId // Track which tab sent this load request
      });
    }

    return true;
  } else {
    return false;
  }
}

// Get WebSocket connection state
export function isWebSocketConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN && isWsAuthenticated;
}

// Get tabId for a pending load request
export function getPendingLoadTabId(pageKey: string, layer: number, layerId: string): number | undefined {
  const requestKey = `load_${JSON.stringify({ pageKey, layer, layerId })}`;
  const pending = pendingRequests.get(requestKey);
  return pending?.tabId;
}

// Cleanup function (exported for use in logout)
export function cleanup() {
  // Clear all pending request timeouts
  for (const [key, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timeout);
  }
  pendingRequests.clear();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  isWsAuthenticated = false;
  reconnectAttempts = 0;
}

// Public disconnect function for service worker termination
export function disconnectWebSocket() {
  cleanup();
}
