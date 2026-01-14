import { getTabsOnPage, getTrackedTabs } from '../tabs/tracking';
import { sendWebSocketMessage, getPendingLoadTabId } from './index';
import * as encryption from '../encryption';
import { WebSocketMessageType } from '../../shared/messageTypes';

// Helper: Decrypt or decode a single stroke
async function processStroke(stroke: any, layer: number): Promise<any | null> {
  // Check if this is a private layer stroke (has nonce)
  if (layer === 1 && stroke.nonce) {
    try {
      // Get DEK1 from session storage
      const sessionData = await chrome.storage.session.get(['DEK1']);
      const dek1Value = sessionData.DEK1 as string | undefined;
      if (!dek1Value) {
        console.warn(`⚠️ DEK1 not available, skipping private stroke ${stroke.id}`);
        return null;
      }

      const DEK1 = encryption.base64ToUint8Array(dek1Value);
      const nonceBytes = encryption.base64ToUint8Array(stroke.nonce);
      const ciphertext = encryption.base64ToUint8Array(stroke.content);

      // Decrypt the stroke content (decryptStroke already returns an object)
      const strokeContent = encryption.decryptStroke(DEK1, nonceBytes, ciphertext);

      return {
        id: stroke.id,
        userId: stroke.userId,
        ...strokeContent
      };
    } catch (error) {
      console.log(`❌ Failed to decrypt private stroke ${stroke.id}:`, error);
      return null;
    }
  } else {
    // Public layer - just decode base64 content
    try {
      const contentBytes = Uint8Array.from(atob(stroke.content), c => c.charCodeAt(0));
      const contentJson = new TextDecoder().decode(contentBytes);
      const strokeContent = JSON.parse(contentJson);

      return {
        id: stroke.id,
        userId: stroke.userId,
        ...strokeContent
      };
    } catch (error) {
      console.log(`❌ Failed to decode public stroke ${stroke.id}:`, error);
      return null;
    }
  }
}

// Handle WebSocket response messages
export async function handleWebSocketResponse(message: any) {
  const { type, data } = message;
  console.log(message);

  // Handle load_response - decrypt and forward strokes to requesting tab
  if (type === 'load_response') {
    if (data && data.pageKey && data.strokes) {
      // Decrypt strokes before forwarding
      const decryptedStrokes = await Promise.all(
        data.strokes.map(async (stroke: any) => processStroke(stroke, data.layer))
      );

      // Filter out null strokes (failed decryption)
      const validStrokes = decryptedStrokes.filter(stroke => stroke !== null);

      // First, try to get the tabId from pending requests (most reliable)
      const pendingTabId = getPendingLoadTabId(data.pageKey, data.layer, data.layerId || '');

      if (pendingTabId) {
        console.log(`📨 load_response for pageKey ${data.pageKey}, sending to requesting tab ${pendingTabId}`);
        chrome.tabs.sendMessage(pendingTabId, {
          type: WebSocketMessageType.WEBSOCKET_MESSAGE,
          message: {
            type: 'load_response',
            data: {
              ...data,
              strokes: validStrokes
            }
          }
        }).catch(() => {
          console.log(`❓ Could not send load_response to tab ${pendingTabId}`);
        });
      } else {
        // Fallback: Find tabs with this pageKey (for push messages, not responses)
        const tabs = await getTrackedTabs();
        const matchingTabs: number[] = [];

        for (const [tabId, tab] of tabs.entries()) {
          if (tab.pageKey === data.pageKey) {
            matchingTabs.push(tabId);
          }
        }

        console.log(`📨 load_response for pageKey ${data.pageKey}, found ${matchingTabs.length} tabs (fallback)`);

        // Send to matching tabs
        for (const tabId of matchingTabs) {
          chrome.tabs.sendMessage(tabId, {
            type: WebSocketMessageType.WEBSOCKET_MESSAGE,
            message: {
              type: 'load_response',
              data: {
                ...data,
                strokes: validStrokes
              }
            }
          }).catch(() => {
            console.log(`❓ Could not send load_response to tab ${tabId}`);
          });
        }
      }
    }
    return;
  }

  // Handle draw_response - forward to all tabs on the page
  if (type === 'draw_response' && data) {
    const { pageKey, userStrokeId, strokeId, success } = data;

    console.log(`📨 WebSocket response received: draw_response`, { pageKey, userStrokeId, strokeId, success });

    // Forward to all tabs on this page
    const tabs = await getTabsOnPage(pageKey);
    for (const tabId of tabs) {
      chrome.tabs.sendMessage(tabId, {
        type: WebSocketMessageType.WEBSOCKET_MESSAGE,
        message: {
          type: 'draw_response',
          data: { userStrokeId, strokeId, success }
        }
      }).catch(() => {
        console.log(`❓ Could not send draw_response to tab ${tabId}`);
      });
    }
    return;
  }

  // Handle redo_response - forward to all tabs on the page
  if (type === 'redo_response' && data) {
    const { pageKey, userStrokeId, strokeId, success } = data;

    console.log(`📨 WebSocket response received: redo_response`, { pageKey, userStrokeId, strokeId, success });

    // Forward to all tabs on this page
    const tabs = await getTabsOnPage(pageKey);
    for (const tabId of tabs) {
      chrome.tabs.sendMessage(tabId, {
        type: WebSocketMessageType.WEBSOCKET_MESSAGE,
        message: {
          type: 'redo_response',
          data: { userStrokeId, strokeId, success }
        }
      }).catch(() => {
        console.log(`❓ Could not send redo_response to tab ${tabId}`);
      });
    }
    return;
  }

  // Handle other responses (subscribe_response, unsubscribe_response)
  // These can just be logged for now, or we could track success/failure
  console.log(`📨 WebSocket response received: ${type}`, data);
}

// Handle new_stroke push message
export async function handleNewStroke(message: any) {
  const { data } = message;
  if (!data || !data.pageKey || !data.stroke) {
    console.warn('⚠️ Invalid new_stroke message:', message);
    return;
  }

  const { pageKey, layer, layerId, stroke } = data;

  console.log(`🎨 Received new_stroke for page: ${pageKey}, userId: ${stroke.userId}, layer: ${layer}`);

  // Decrypt/decode stroke before forwarding
  const strokeToSend = await processStroke(stroke, layer);
  if (!strokeToSend) {
    return; // Failed to process stroke
  }

  // Forward to all tabs on this page
  const tabs = await getTabsOnPage(pageKey);
  console.log(`📋 Found ${tabs.length} tabs on page ${pageKey}:`, tabs);

  for (const tabId of tabs) {
    console.log(`📨 Forwarding stroke to tab ${tabId}`);
    chrome.tabs.sendMessage(tabId, {
      type: WebSocketMessageType.WEBSOCKET_MESSAGE,
      message: {
        type: 'new_stroke',
        data: { stroke: strokeToSend }
      }
    }).catch((error) => {
      if (error instanceof Error) {
        console.log(`❓ Could not send new_stroke to tab ${tabId}:`, error.message);
      } else {
        console.log(`❓ Could not send new_stroke to tab ${tabId}:`, String(error));
      }
    });
  }
}

// Handle delete_stroke push message
export async function handleDeleteStroke(message: any) {
  const { data } = message;
  if (!data || !data.pageKey || !data.strokeId || !data.userId) {
    console.warn('⚠️ Invalid delete_stroke message:', message);
    return;
  }

  const { pageKey, strokeId, userId } = data;

  console.log(`🗑️ Received delete_stroke for page: ${pageKey}, strokeId: ${strokeId}, userId: ${userId}`);

  // Forward to all tabs on this page
  const tabs = await getTabsOnPage(pageKey);
  console.log(`📋 Found ${tabs.length} tabs on page ${pageKey}:`, tabs);

  for (const tabId of tabs) {
    console.log(`📨 Forwarding delete_stroke to tab ${tabId}`);
    chrome.tabs.sendMessage(tabId, {
      type: WebSocketMessageType.WEBSOCKET_MESSAGE,
      message: {
        type: 'delete_stroke',
        data: { strokeId, userId }
      }
    }).catch((error) => {
      if (error instanceof Error) {
        console.log(`❓ Could not send delete_stroke to tab ${tabId}:`, error.message);
      } else {
        console.log(`❓ Could not send delete_stroke to tab ${tabId}:`, String(error));
      }
    });
  }
}

// Track if we initiated a key version change (to avoid locking ourselves)
let localKeyVersionChange = false;

// Handle keys_updated push message
export async function handleKeysUpdated(message: any) {
  const { data } = message;
  if (!data) {
    console.warn('⚠️ Invalid keys_updated message:', message);
    return;
  }

  const { keyVersion, keysDeleted } = data;
  console.log(`🔑 Received keys_updated: keyVersion=${keyVersion}, keysDeleted=${keysDeleted}, localChange=${localKeyVersionChange}`);

  // Get current user state to compare
  const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');

  if (!userState) {
    console.log('⚠️ No user state found, ignoring keys_updated message');
    return;
  }

  // Check if we should lock the user:
  // 1. KeyVersion increased in another session (password reset elsewhere)
  // 2. Keys deleted (private layer disabled in another session)
  const keyVersionIncreased = keyVersion > userState.keyVersion;
  const keysWereDeleted = keysDeleted === true;
  const initiatedHere = localKeyVersionChange;

  // Reset the flag for next time
  if (initiatedHere) {
    localKeyVersionChange = false;
    // Don't update storage here - handleSetupEncryption already saved the complete state
    // Updating here could race with the handleSetupEncryption save and overwrite with stale data
    return;
  }

  if ((keyVersionIncreased && !initiatedHere) || keysWereDeleted) {
    const { lockUser } = await import('../encryption/lockHelper');

    if (keyVersionIncreased && !initiatedHere) {
      await lockUser(`KeyVersion increased from ${userState.keyVersion} to ${keyVersion} (remote change)`);
    } else if (keysWereDeleted) {
      await lockUser('Keys deleted in another session');
    }
  }

  // Update local storage with new key version
  // Only do this for remote changes - local changes are already saved by handleSetupEncryption
  if (!initiatedHere) {
    // Remote change: fetch fresh user data from backend
    try {
      const { getCurrentUser } = await import('../api/endpoints');
      const userData = await getCurrentUser(userState.token);

      if (userData === null) {
        // 401 response - logout user
        console.log('⚠️ User token invalid (401), logging out');

        // Clear all session storage (tracked tabs, subscriptions, toolbar states, etc.)
        await chrome.storage.session.clear();
        console.log('🗑️ Cleared all session storage (401 auth error in key version handler)');

        return;
      }

      // Update local storage with fresh data from backend
      const updatedUserState = {
        ...userState,
        username: userData.username,
        id: userData.id,
        keyVersion: userData.keyVersion,
        saltKEK: userData.saltKEK,
        encryptedDEK1: userData.encryptedDEK1,
        nonceDEK1: userData.nonceDEK1,
        encryptedDEK2: userData.encryptedDEK2,
        nonceDEK2: userData.nonceDEK2
      };

      await chrome.storage.local.set({
        webverse_user_state: updatedUserState
      });

      console.log('✅ Updated local storage with fresh keys from backend');
    } catch (error) {
      console.log('❌ Failed to fetch updated user data from backend:', error);
      // Fallback: at least update the keyVersion
      const fallbackUserState = {
        ...userState,
        keyVersion: keyVersion
      };
      await chrome.storage.local.set({
        webverse_user_state: fallbackUserState
      });
    }
  }
}

// Mark that we're about to initiate a key version change
export function markLocalKeyVersionChange(): void {
  localKeyVersionChange = true;
  console.log('📝 Marking local key version change');
}

// Reset the flag after completing local key version change
export function resetLocalKeyVersionChange(): void {
  localKeyVersionChange = false;
  console.log('🔄 Resetting local key version change flag');
}
