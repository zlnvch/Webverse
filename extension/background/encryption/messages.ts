import * as encryption from './index';
import * as api from '../api/endpoints';
import * as layerManagement from '../layers/management';
import { markLocalKeyVersionChange, resetLocalKeyVersionChange } from '../websocket/handlers';
import { EncryptionMessageType } from '../../shared/messageTypes';

// Cached encryption status (updated whenever keys change)
let isEncryptionUnlocked = false;

// Export function to update encryption cache (used by logout handler)
export function setEncryptionUnlocked(unlocked: boolean) {
  isEncryptionUnlocked = unlocked;
}

// Initialize encryption status cache on startup
export function initializeEncryptionCache() {
  chrome.storage.session.get(['DEK1', 'DEK2'], (result) => {
    isEncryptionUnlocked = !!(result.DEK1 && result.DEK2);
  });
}

// Handle get encryption status request
export async function handleGetEncryptionStatus(message: any, sendResponse: (response?: any) => void) {
  sendResponse({ success: true, isUnlocked: isEncryptionUnlocked });
  return true;
}

// Handle lock encryption request
export async function handleLockEncryption(message: any, sendResponse: (response?: any) => void) {
  try {
    const { lockUser } = await import('./lockHelper');

    // Lock the user (clears keys, notifies tabs, switches to public, and updates cache)
    await lockUser('Manual lock from popup');

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to lock encryption' });
  }
  return true;
}

// Handle unlock encryption request
export async function handleUnlockEncryption(message: any, sendResponse: (response?: any) => void) {
  try {
    const { password } = message;

    if (!password) {
      await chrome.storage.local.set({
        webverse_unlock_result: {
          success: false,
          error: 'Password is required',
          timestamp: Date.now()
        }
      });
      return true;
    }

    // Get user state
    const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');

    if (!userState || !userState.encryptedDEK1 || !userState.nonceDEK1 || !userState.saltKEK) {
      await chrome.storage.local.set({
        webverse_unlock_result: {
          success: false,
          error: 'Encryption not set up',
          timestamp: Date.now()
        }
      });
      return true;
    }

    // Derive KEK from password
    const salt = encryption.base64ToUint8Array(userState.saltKEK);
    const kek = await encryption.deriveKEK(password, salt);

    // Try to decrypt DEK1
    try {
      const encryptedDEK1 = encryption.base64ToUint8Array(userState.encryptedDEK1);
      const nonce1 = encryption.base64ToUint8Array(userState.nonceDEK1);
      const DEK1 = encryption.decryptDEK(encryptedDEK1, nonce1, kek);

      // If DEK1 decryption succeeded, decrypt DEK2
      const encryptedDEK2 = encryption.base64ToUint8Array(userState.encryptedDEK2);
      const nonce2 = encryption.base64ToUint8Array(userState.nonceDEK2);
      const DEK2 = encryption.decryptDEK(encryptedDEK2, nonce2, kek);

      // Store decrypted keys in session storage
      await chrome.storage.session.set({
        DEK1: encryption.uint8ArrayToBase64(DEK1),
        DEK2: encryption.uint8ArrayToBase64(DEK2)
      });

      // Update cached value
      setEncryptionUnlocked(true);

      // Notify all tabs about encryption status change
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: EncryptionMessageType.ENCRYPTION_STATUS_UPDATE,
            isUnlocked: true
          }).catch(() => {
            // Tab might not have content script loaded, ignore
          });
        }
      }

      await chrome.storage.local.set({
        webverse_unlock_result: {
          success: true,
          timestamp: Date.now()
        }
      });
    } catch (decryptError) {
      await chrome.storage.local.set({
        webverse_unlock_result: {
          success: false,
          error: 'Incorrect password',
          timestamp: Date.now()
        }
      });
    }
  } catch (error) {
    await chrome.storage.local.set({
      webverse_unlock_result: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to unlock encryption',
        timestamp: Date.now()
      }
    });
  }
  return true;
}

// Handle setup encryption request
export async function handleSetupEncryption(message: any, sendResponse: (response?: any) => void) {
  try {
    const { password, isReset } = message;

    if (!password) {
      await chrome.storage.local.set({
        webverse_setup_encryption_result: {
          success: false,
          error: 'Password is required',
          timestamp: Date.now()
        }
      });
      return true;
    }

    // Mark that we're about to change the key version
    // This prevents the keys_updated handler from locking us
    markLocalKeyVersionChange();

    // Get user state and token
    const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');

    if (!userState || !userState.token) {
      await chrome.storage.local.set({
        webverse_setup_encryption_result: {
          success: false,
          error: 'User not logged in',
          timestamp: Date.now()
        }
      });
      return true;
    }

    // Generate salt and KEK
    const salt = encryption.generateSalt();
    const kek = await encryption.deriveKEK(password, salt);

    // Generate and encrypt DEK1 and DEK2
    const DEK1 = encryption.generateDEK();
    const DEK2 = encryption.generateDEK();

    const encrypted1 = encryption.encryptDEK(DEK1, kek);
    const encrypted2 = encryption.encryptDEK(DEK2, kek);

    // Prepare API request with correct field names for Go
    const saltKEK = encryption.uint8ArrayToBase64(salt);
    const encryptedDEK1 = encryption.uint8ArrayToBase64(encrypted1.ciphertext);
    const nonceDEK1 = encryption.uint8ArrayToBase64(encrypted1.nonce);
    const encryptedDEK2 = encryption.uint8ArrayToBase64(encrypted2.ciphertext);
    const nonceDEK2 = encryption.uint8ArrayToBase64(encrypted2.nonce);

    // Call API via endpoint
    let apiResponse;
    try {
      apiResponse = await api.setupEncryptionKeys(
        userState.token,
        saltKEK,
        encryptedDEK1,
        nonceDEK1,
        encryptedDEK2,
        nonceDEK2
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHORIZED') {
        await chrome.storage.local.set({
          webverse_setup_encryption_result: {
            success: false,
            logout: true,
            timestamp: Date.now()
          }
        });
        return true;
      }
      throw error;
    }

    // Update user state with new key version and encryption keys
    const updatedUserState = {
      ...userState,
      keyVersion: apiResponse.keyVersion,
      saltKEK,
      encryptedDEK1,
      nonceDEK1,
      encryptedDEK2,
      nonceDEK2
    };

    await chrome.storage.local.set({
      webverse_user_state: updatedUserState
    });

    // Reset the flag now that keyVersion is persisted
    // Any WS keys_updated message arriving now will see the new keyVersion
    resetLocalKeyVersionChange();

    // Store decrypted keys in session storage
    await chrome.storage.session.set({
      DEK1: encryption.uint8ArrayToBase64(DEK1),
      DEK2: encryption.uint8ArrayToBase64(DEK2)
    });

    // Update cached value
    setEncryptionUnlocked(true);

    // Notify all tabs about encryption status change
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: EncryptionMessageType.ENCRYPTION_STATUS_UPDATE,
          isUnlocked: true
        }).catch(() => {
          // Tab might not have content script loaded, ignore
        });
      }
    }

    await chrome.storage.local.set({
      webverse_setup_encryption_result: {
        success: true,
        keyVersion: apiResponse.keyVersion,
        userData: updatedUserState,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.log('❌ Setup encryption failed:', error);

    // Reset the flag since the operation failed
    resetLocalKeyVersionChange();

    await chrome.storage.local.set({
      webverse_setup_encryption_result: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to setup encryption',
        timestamp: Date.now()
      }
    });
  }
  return true;
}

// Handle change password request
export async function handleChangePassword(message: any, sendResponse: (response?: any) => void) {
  try {
    const { password } = message;

    if (!password) {
      await chrome.storage.local.set({
        webverse_change_password_result: {
          success: false,
          error: 'Password is required',
          timestamp: Date.now()
        }
      });
      return true;
    }

    // Get user state and token
    const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');

    if (!userState || !userState.token) {
      await chrome.storage.local.set({
        webverse_change_password_result: {
          success: false,
          error: 'User not logged in',
          timestamp: Date.now()
        }
      });
      return true;
    }

    // Get current DEK1 and DEK2 from session storage (already decrypted)
    const sessionData = await chrome.storage.session.get(['DEK1', 'DEK2']);

    if (!sessionData.DEK1 || !sessionData.DEK2) {
      await chrome.storage.local.set({
        webverse_change_password_result: {
          success: false,
          error: 'Private layer is not unlocked',
          timestamp: Date.now()
        }
      });
      return true;
    }

    const DEK1 = encryption.base64ToUint8Array(sessionData.DEK1);
    const DEK2 = encryption.base64ToUint8Array(sessionData.DEK2);

    // Mark that we're about to change the key version
    // This prevents the keys_updated handler from locking us
    markLocalKeyVersionChange();

    // Generate new salt and KEK from new password
    const salt = encryption.generateSalt();
    const kek = await encryption.deriveKEK(password, salt);

    // Re-encrypt DEK1 and DEK2 with new KEK
    const encrypted1 = encryption.encryptDEK(DEK1, kek);
    const encrypted2 = encryption.encryptDEK(DEK2, kek);

    // Prepare API request with correct field names for Go
    const saltKEK = encryption.uint8ArrayToBase64(salt);
    const encryptedDEK1 = encryption.uint8ArrayToBase64(encrypted1.ciphertext);
    const nonceDEK1 = encryption.uint8ArrayToBase64(encrypted1.nonce);
    const encryptedDEK2 = encryption.uint8ArrayToBase64(encrypted2.ciphertext);
    const nonceDEK2 = encryption.uint8ArrayToBase64(encrypted2.nonce);

    // Call API via endpoint
    let apiResponse;
    try {
      apiResponse = await api.changeEncryptionPassword(
        userState.token,
        saltKEK,
        encryptedDEK1,
        nonceDEK1,
        encryptedDEK2,
        nonceDEK2
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHORIZED') {
        await chrome.storage.local.set({
          webverse_change_password_result: {
            success: false,
            logout: true,
            timestamp: Date.now()
          }
        });
        return true;
      }
      throw error;
    }

    // Update user state with new key version and encryption keys
    const updatedUserState = {
      ...userState,
      keyVersion: apiResponse.keyVersion,
      saltKEK,
      encryptedDEK1,
      nonceDEK1,
      encryptedDEK2,
      nonceDEK2
    };

    await chrome.storage.local.set({
      webverse_user_state: updatedUserState
    });

    // Reset the flag now that keyVersion is persisted
    // Any WS keys_updated message arriving now will see the new keyVersion
    resetLocalKeyVersionChange();

    // DEK1 and DEK2 remain in session storage (already decrypted)

    await chrome.storage.local.set({
      webverse_change_password_result: {
        success: true,
        keyVersion: apiResponse.keyVersion,
        userData: updatedUserState,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.log('❌ Change password failed:', error);

    // Reset the flag since the operation failed
    resetLocalKeyVersionChange();

    await chrome.storage.local.set({
      webverse_change_password_result: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to change password',
        timestamp: Date.now()
      }
    });
  }
  return true;
}

// Handle disable private layer request
export async function handleDisablePrivateLayer(message: any, sendResponse: (response?: any) => void) {
  try {
    // Get user state and token
    const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');

    if (!userState || !userState.token) {
      await chrome.storage.local.set({
        webverse_disable_private_layer_result: {
          success: false,
          error: 'You must be logged in to disable the private layer.',
          timestamp: Date.now()
        }
      });
      return true;
    }

    // Call DELETE /me/encryption-keys API via endpoint
    try {
      await api.disablePrivateLayer(userState.token);
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHORIZED') {
        await chrome.storage.local.set({
          webverse_disable_private_layer_result: {
            success: false,
            logout: true,
            timestamp: Date.now()
          }
        });
        return true;
      }
      throw error;
    }

    // Clear encryption keys from user state
    // We need to create a new object without the encryption key fields
    const { saltKEK, encryptedDEK1, nonceDEK1, encryptedDEK2, nonceDEK2, keyVersion, ...userStateWithoutKeys } = userState;

    const updatedUserState = {
      ...userStateWithoutKeys,
      saltKEK: null, // Explicitly set to null instead of undefined
      encryptedDEK1: null,
      nonceDEK1: null,
      encryptedDEK2: null,
      nonceDEK2: null,
      keyVersion: null
    };

    await chrome.storage.local.set({
      webverse_user_state: updatedUserState
    });

    // Lock the user (clears keys, notifies tabs, and switches to public layer)
    const { lockUser } = await import('./lockHelper');
    await lockUser('Private layer disabled');

    await chrome.storage.local.set({
      webverse_disable_private_layer_result: {
        success: true,
        userData: updatedUserState,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.log('❌ Disable private layer failed:', error);
    await chrome.storage.local.set({
      webverse_disable_private_layer_result: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disable private layer',
        timestamp: Date.now()
      }
    });
  }
  return true;
}

// Handle encrypt stroke request (from toolbar)
export async function handleEncryptStroke(message: any, sendResponse: (response?: any) => void) {
  try {
    const { strokeContent, keyVersion } = message;

    // Get DEK1 from session storage
    const sessionData = await chrome.storage.session.get(['DEK1']);
    if (!sessionData.DEK1) {
      sendResponse({ success: false, error: 'Encryption keys not available' });
      return true;
    }

    const DEK1 = encryption.base64ToUint8Array(sessionData.DEK1);

    // Encrypt the stroke content
    const encrypted = encryption.encryptStroke(DEK1, strokeContent);

    // Convert to backend format
    const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');
    const userId = userState?.id || '';

    const backendStroke = {
      id: '',  // Will be assigned by backend
      userId,
      nonce: encryption.uint8ArrayToBase64(encrypted.nonce),
      content: encryption.uint8ArrayToBase64(encrypted.ciphertext)
    };

    sendResponse({
      success: true,
      stroke: backendStroke,
      nonce: backendStroke.nonce,
      layerId: keyVersion || ''
    });
  } catch (error) {
    console.log('❌ Encrypt stroke failed:', error);
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to encrypt stroke' });
  }
  return true;
}

// Handle decrypt stroke request (from content script)
export async function handleDecryptStroke(message: any, sendResponse: (response?: any) => void) {
  try {
    const { backendStroke, nonce } = message;

    if (!nonce) {
      // Public layer - just decode base64 content
      const contentBytes = Uint8Array.from(atob(backendStroke.content), c => c.charCodeAt(0));
      const contentJson = new TextDecoder().decode(contentBytes);
      const strokeContent = JSON.parse(contentJson);

      sendResponse({
        success: true,
        stroke: {
          id: backendStroke.id,
          userId: backendStroke.userId,
          ...strokeContent
        }
      });
      return true;
    }

    // Private layer - decrypt using DEK1
    const sessionData = await chrome.storage.session.get(['DEK1']);
    if (!sessionData.DEK1) {
      sendResponse({ success: false, error: 'Decryption keys not available' });
      return true;
    }

    const DEK1 = encryption.base64ToUint8Array(sessionData.DEK1);
    const nonceBytes = encryption.base64ToUint8Array(nonce);
    const ciphertext = encryption.base64ToUint8Array(backendStroke.content);

    const decryptedContent = encryption.decryptStroke(DEK1, nonceBytes, ciphertext);
    const strokeContent = JSON.parse(new TextDecoder().decode(decryptedContent));

    sendResponse({
      success: true,
      stroke: {
        id: backendStroke.id,
        userId: backendStroke.userId,
        ...strokeContent
      }
    });
  } catch (error) {
    console.log('❌ Decrypt stroke failed:', error);
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to decrypt stroke' });
  }
  return true;
}

// Handle generate private page key request
export async function handleGeneratePrivatePageKey(message: any, sendResponse: (response?: any) => void) {
  try {
    const { canonicalUrl } = message;

    // Get DEK2 from session storage
    const sessionData = await chrome.storage.session.get(['DEK2']);
    if (!sessionData.DEK2) {
      sendResponse({ success: false, error: 'DEK2 not available' });
      return true;
    }

    const DEK2 = encryption.base64ToUint8Array(sessionData.DEK2);
    const pageKeyBytes = encryption.computeHMACPageKey(DEK2, canonicalUrl);
    const pageKey = encryption.uint8ArrayToBase64(pageKeyBytes);

    sendResponse({ success: true, pageKey });
  } catch (error) {
    console.log('❌ Generate private page key failed:', error);
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to generate page key' });
  }
  return true;
}
