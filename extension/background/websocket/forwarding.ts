import * as encryption from '../encryption';
import { sendWebSocketMessage } from './index';
import * as subscriptions from './subscriptions';

// Handle WebSocket forward request from content script
export async function handleWebSocketForward(message: any, sender: any, sendResponse: (response?: any) => void) {
  const { message: wsMessage } = message;
  const tabId = sender?.tab?.id; // Get tabId from sender

  // Check if this is a subscribe message - only send if not already subscribed
  if (wsMessage.type === 'subscribe' && wsMessage.data) {
    const { pageKey, layer, layerId } = wsMessage.data;

    if (await subscriptions.isSubscribed(pageKey, layer, layerId)) {
      sendResponse({ success: true, alreadySubscribed: true });
      return true;
    }

    // Mark as subscribed before sending to avoid race conditions
    await subscriptions.addSubscription(pageKey, layer, layerId);
  }

  // Check if this is an unsubscribe message - remove from tracking
  if (wsMessage.type === 'unsubscribe' && wsMessage.data) {
    const { pageKey, layer, layerId } = wsMessage.data;
    await subscriptions.removeSubscription(pageKey, layer, layerId);
  }

  // Check if this is a draw or redo message that needs encryption
  if ((wsMessage.type === 'draw' || wsMessage.type === 'redo') && wsMessage.data) {
    const { pageKey, stroke, userStrokeId, layer } = wsMessage.data;

    // Prepare stroke content for backend
    const strokeContent = {
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      startX: stroke.startX,
      startY: stroke.startY,
      dx: stroke.dx,
      dy: stroke.dy
    };

    let preparedStroke: any;
    let finalLayerId = '';
    let finalPageKey = pageKey;
    const isRedo = wsMessage.type === 'redo';

    if (layer === 1) { // Private layer - encrypt
      // Get DEK1 from session storage for encryption
      const sessionData = await chrome.storage.session.get(['DEK1', 'DEK2']);
      if (!sessionData.DEK1 || !sessionData.DEK2) {
        console.log('❌ DEK1/DEK2 not available for encryption');
        sendResponse({ success: false, error: 'Encryption keys not available' });
        return true;
      }

      const DEK1 = encryption.base64ToUint8Array(sessionData.DEK1);
      const DEK2 = encryption.base64ToUint8Array(sessionData.DEK2);

      // Encrypt the stroke content
      const encrypted = encryption.encryptStroke(DEK1, strokeContent);

      // Get user ID and keyVersion
      const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');
      const userId = userState?.id || '';
      const keyVersion = userState?.keyVersion;

      // Generate private pageKey using DEK2
      const canonicalUrl = pageKey; // pageKey from content script is actually the canonical URL
      const pageKeyBytes = encryption.computeHMACPageKey(DEK2, canonicalUrl);
      finalPageKey = encryption.uint8ArrayToBase64(pageKeyBytes);

      preparedStroke = {
        id: isRedo ? stroke.id : '',  // Redo preserves original ID, draw gets new ID from backend
        userId,
        nonce: encryption.uint8ArrayToBase64(encrypted.nonce),
        content: encryption.uint8ArrayToBase64(encrypted.ciphertext)
      };
      finalLayerId = keyVersion?.toString() || '';
    } else { // Public layer - just encode
      const contentJson = JSON.stringify(strokeContent);
      const contentBytes = new TextEncoder().encode(contentJson);
      const contentBase64 = btoa(String.fromCharCode.apply(null, Array.from(contentBytes)));

      // Get user ID
      const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');
      const userId = userState?.id || '';

      preparedStroke = {
        id: isRedo ? stroke.id : '',  // Redo preserves original ID, draw gets new ID from backend
        userId,
        content: contentBase64
      };
      finalLayerId = '';
    }

    // Update the message with encrypted/encoded stroke
    const updatedMessage = {
      ...wsMessage,
      data: {
        pageKey: finalPageKey,
        stroke: preparedStroke,
        userStrokeId,
        layer,
        layerId: finalLayerId
      }
    };

    // Send to WebSocket (no need to track tabId for draw/redo responses)
    const success = sendWebSocketMessage(updatedMessage);
    sendResponse({ success });
  } else {
    // Just forward as-is (for load messages and others)
    // Pass tabId so we can track which tab made the load request
    const success = sendWebSocketMessage(wsMessage, tabId);
    sendResponse({ success });
  }
  return true;
}

// Handle WebSocket connection request from toolbar
export async function handleWebSocketConnect(message: any, sendResponse: (response?: any) => void) {
  // Connect WebSocket if not connected or not authenticated
  if (!sendWebSocketMessage || typeof sendWebSocketMessage !== 'function') {
    // Import dynamically to avoid circular dependency
    const { isWebSocketConnected, connectWebSocket } = await import('./index');

    if (!isWebSocketConnected()) {
      connectWebSocket();
    }
  }

  sendResponse({ success: true });
  return true;
}

// Handle WebSocket send message request
export async function handleWebSocketSendMessage(message: any, sendResponse: (response?: any) => void) {
  const { message: wsMessage } = message;

  // Send to WebSocket
  const success = sendWebSocketMessage(wsMessage);
  sendResponse({ success });
  return true;
}
