import * as tabLifecycle from '../tabs/lifecycle';
import * as websocketForwarding from '../websocket/forwarding';
import * as encryptionMessages from '../encryption/messages';
import * as userOperations from '../user/operations';
import * as webverseLaunch from '../webverse/launch';
import * as layerManagement from '../layers/management';
import {
  TabLifecycleMessageType,
  WebSocketMessageType,
  EncryptionMessageType,
  UserMessageType,
  StateSyncMessageType,
  LayerMessageType,
  UtilityMessageType
} from '../../shared/messageTypes';

// Define message type sets for routing
const TAB_MESSAGE_TYPES = new Set([
  TabLifecycleMessageType.GET_TAB_ID,
  TabLifecycleMessageType.GET_TAB_ID_FOR_TOOLBAR,
  TabLifecycleMessageType.CONTENT_SCRIPT_READY,
  TabLifecycleMessageType.TOOLBAR_OPENED,
  TabLifecycleMessageType.TOOLBAR_CLOSED,
  TabLifecycleMessageType.GET_TAB_KEY_VERSION,
  TabLifecycleMessageType.SPA_URL_CHANGED,
  UtilityMessageType.SAVE_TOOLBAR_STATE,
]);

const WEBSOCKET_MESSAGE_TYPES = new Set([
  WebSocketMessageType.WEBSOCKET_FORWARD,
  WebSocketMessageType.WEBSOCKET_CONNECT,
]);

const ENCRYPTION_MESSAGE_TYPES = new Set([
  EncryptionMessageType.GET_ENCRYPTION_STATUS,
  EncryptionMessageType.LOCK_ENCRYPTION,
  EncryptionMessageType.UNLOCK_ENCRYPTION,
  EncryptionMessageType.SETUP_ENCRYPTION,
  EncryptionMessageType.CHANGE_PASSWORD,
  EncryptionMessageType.DISABLE_PRIVATE_LAYER,
  EncryptionMessageType.ENCRYPT_STROKE,
  EncryptionMessageType.DECRYPT_STROKE,
  EncryptionMessageType.GENERATE_PRIVATE_PAGE_KEY,
]);

const USER_MESSAGE_TYPES = new Set([
  UserMessageType.USER_LOGOUT,
  UserMessageType.DELETE_ACCOUNT,
  UserMessageType.REFRESH_USER_DATA,
  UserMessageType.OAUTH_REQUEST,
]);

const WEBVERSE_MESSAGE_TYPES = new Set([
  StateSyncMessageType.LAUNCH_WEBVERSE,
  UtilityMessageType.GET_NEXT_STROKE_ID,
]);

const LAYER_MESSAGE_TYPES = new Set([
  LayerMessageType.SWITCH_LAYER,
]);

// Setup message handlers
export function setupMessageHandlers() {
  chrome.runtime.onMessage.addListener(
    async (message: any, sender: any, sendResponse: (response?: any) => void) => {
      // Add safety check
      if (!message || typeof message !== 'object') {
        console.log('❌ Invalid message received:', message);
        sendResponse({ success: false, error: 'Invalid message' });
        return false;
      }

      console.log('Background received message:', message.type);

      // Handle ping for connection testing
      if (message.type === UtilityMessageType.PING) {
        console.log('Received ping, sending pong');
        sendResponse({ type: UtilityMessageType.PONG, timestamp: Date.now() });
        return true;
      }

      // Route to appropriate handler based on message type
      if (TAB_MESSAGE_TYPES.has(message.type)) {
        return await routeTabMessage(message, sender, sendResponse);
      }

      if (WEBSOCKET_MESSAGE_TYPES.has(message.type)) {
        return await routeWebSocketMessage(message, sender, sendResponse);
      }

      if (ENCRYPTION_MESSAGE_TYPES.has(message.type)) {
        return await routeEncryptionMessage(message, sender, sendResponse);
      }

      if (USER_MESSAGE_TYPES.has(message.type)) {
        return await routeUserMessage(message, sender, sendResponse);
      }

      if (WEBVERSE_MESSAGE_TYPES.has(message.type)) {
        return await routeWebverseMessage(message, sender, sendResponse);
      }

      if (LAYER_MESSAGE_TYPES.has(message.type)) {
        return await routeLayerMessage(message, sender, sendResponse);
      }

      // For any other message types
      console.log('Unhandled message type:', message.type);
      return false;
    }
  );
}

// Route tab-related messages
async function routeTabMessage(message: any, sender: any, sendResponse: (response?: any) => void) {
  switch (message.type) {
    case TabLifecycleMessageType.GET_TAB_ID:
      return await tabLifecycle.handleGetTabId(message, sender, sendResponse);
    case TabLifecycleMessageType.GET_TAB_ID_FOR_TOOLBAR:
      return await tabLifecycle.handleGetTabIdForToolbar(message, sender, sendResponse);
    case TabLifecycleMessageType.CONTENT_SCRIPT_READY:
      return await tabLifecycle.handleContentScriptReady(message, sender, sendResponse);
    case TabLifecycleMessageType.TOOLBAR_OPENED:
      return await tabLifecycle.handleToolbarOpened(message, sender, sendResponse);
    case TabLifecycleMessageType.TOOLBAR_CLOSED:
      return await tabLifecycle.handleToolbarClosed(message, sender, sendResponse);
    case UtilityMessageType.SAVE_TOOLBAR_STATE:
      return await tabLifecycle.handleSaveToolbarState(message, sender, sendResponse);
    case TabLifecycleMessageType.GET_TAB_KEY_VERSION:
      return await tabLifecycle.handleGetTabKeyVersion(message, sender, sendResponse);
    case TabLifecycleMessageType.SPA_URL_CHANGED:
      return await tabLifecycle.handleSPAUrlChanged(message, sender, sendResponse);
    default:
      return false;
  }
}

// Route WebSocket-related messages
async function routeWebSocketMessage(message: any, sender: any, sendResponse: (response?: any) => void) {
  switch (message.type) {
    case WebSocketMessageType.WEBSOCKET_FORWARD:
      return await websocketForwarding.handleWebSocketForward(message, sender, sendResponse);
    case WebSocketMessageType.WEBSOCKET_CONNECT:
      return await websocketForwarding.handleWebSocketConnect(message, sendResponse);
    case 'WEBSOCKET_SEND_MESSAGE':
      return await websocketForwarding.handleWebSocketSendMessage(message, sendResponse);
    default:
      return false;
  }
}

// Route encryption-related messages
async function routeEncryptionMessage(message: any, sender: any, sendResponse: (response?: any) => void) {
  switch (message.type) {
    case EncryptionMessageType.GET_ENCRYPTION_STATUS:
      return await encryptionMessages.handleGetEncryptionStatus(message, sendResponse);
    case EncryptionMessageType.LOCK_ENCRYPTION:
      return await encryptionMessages.handleLockEncryption(message, sendResponse);
    case EncryptionMessageType.UNLOCK_ENCRYPTION:
      return await encryptionMessages.handleUnlockEncryption(message, sendResponse);
    case EncryptionMessageType.SETUP_ENCRYPTION:
      const { markLocalKeyVersionChange } = await import('../websocket/handlers');
      markLocalKeyVersionChange();
      return await encryptionMessages.handleSetupEncryption(message, sendResponse);
    case EncryptionMessageType.CHANGE_PASSWORD:
      const { markLocalKeyVersionChange: markChange } = await import('../websocket/handlers');
      markChange();
      return await encryptionMessages.handleChangePassword(message, sendResponse);
    case EncryptionMessageType.DISABLE_PRIVATE_LAYER:
      return await encryptionMessages.handleDisablePrivateLayer(message, sendResponse);
    case EncryptionMessageType.ENCRYPT_STROKE:
      return await encryptionMessages.handleEncryptStroke(message, sendResponse);
    case EncryptionMessageType.DECRYPT_STROKE:
      return await encryptionMessages.handleDecryptStroke(message, sendResponse);
    case EncryptionMessageType.GENERATE_PRIVATE_PAGE_KEY:
      return await encryptionMessages.handleGeneratePrivatePageKey(message, sendResponse);
    default:
      return false;
  }
}

// Route user-related messages
async function routeUserMessage(message: any, sender: any, sendResponse: (response?: any) => void) {
  switch (message.type) {
    case UserMessageType.USER_LOGOUT:
      return await userOperations.handleUserLogout(message, sendResponse);
    case UserMessageType.DELETE_ACCOUNT:
      return await userOperations.handleDeleteAccount(message, sendResponse);
    case UserMessageType.REFRESH_USER_DATA:
      return await userOperations.handleRefreshUserData(message, sendResponse);
    case UserMessageType.OAUTH_REQUEST:
      return await userOperations.handleAuthRequest(message, sendResponse);
    default:
      return false;
  }
}

// Route Webverse-related messages
async function routeWebverseMessage(message: any, sender: any, sendResponse: (response?: any) => void) {
  switch (message.type) {
    case StateSyncMessageType.LAUNCH_WEBVERSE:
      return await webverseLaunch.handleLaunchWebverse(message, sendResponse);
    case UtilityMessageType.GET_NEXT_STROKE_ID:
      return await webverseLaunch.handleGetNextStrokeId(message, sendResponse);
    default:
      return false;
  }
}

// Route layer-related messages
async function routeLayerMessage(message: any, sender: any, sendResponse: (response?: any) => void) {
  switch (message.type) {
    case LayerMessageType.SWITCH_LAYER:
      try {
        // Use sender.tab.id since toolbar (injected script) doesn't know its own tab ID
        const tabId = sender.tab?.id;
        if (!tabId) {
          console.log('❌ SWITCH_LAYER: No tab ID in sender');
          sendResponse({ success: false, error: 'No tab ID' });
          return true;
        }

        const { canonicalUrl, layer, keyVersion, toolbarState } = message;

        await layerManagement.switchTabLayer(
          tabId,
          canonicalUrl as string,
          layer as number, // Layer enum (0 or 1)
          keyVersion as string,
          toolbarState // Pass toolbar state directly
        );

        sendResponse({ success: true });
      } catch (error) {
        console.log('❌ Switch layer failed:', error);
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to switch layer' });
      }
      return true;
    default:
      return false;
  }
}
