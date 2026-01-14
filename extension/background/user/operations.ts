import * as api from '../api/endpoints';
import * as websocket from '../websocket';
import * as encryption from '../encryption/messages';
import { EncryptionMessageType, TabLifecycleMessageType } from '../../shared/messageTypes';

// Handle user logout - close WebSocket connection
export async function handleUserLogout(message: any, sendResponse: (response?: any) => void) {
  console.log('👋 User logged out - closing WebSocket connection');
  websocket.cleanup();
  console.log('🔌 WebSocket closed due to user logout');

  // Update encryption cache - keys should be cleared by popup
  encryption.setEncryptionUnlocked(false);

  // Clear all session storage (tracked tabs, subscriptions, toolbar states, etc.)
  await chrome.storage.session.clear();
  console.log('🗑️ Cleared all session storage (tracked tabs, subscriptions, toolbar states)');

  // Notify all tabs to close Webverse
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: TabLifecycleMessageType.CLOSE_WEBVERSE_ON_LOGOUT
        }).catch(() => {
          // Tab might not have content script loaded, ignore
        });
      }
    }
  } catch (error) {
    console.log('Failed to notify tabs about logout:', error);
  }

  sendResponse({ success: true });
  return true;
}

// Handle delete account request
export async function handleDeleteAccount(message: any, sendResponse: (response?: any) => void) {
  try {
    const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');

    if (!userState || !userState.isLoggedIn || !userState.id || !userState.token) {
      await chrome.storage.local.set({
        webverse_delete_account_result: {
          success: false,
          error: 'User not logged in',
          timestamp: Date.now()
        }
      });
      return true;
    }

    await api.deleteAccount(userState.id, userState.token);

    await chrome.storage.local.set({
      webverse_delete_account_result: {
        success: true,
        timestamp: Date.now()
      }
    });

    // Close WebSocket connection
    websocket.cleanup();

    // Clear all session storage (tracked tabs, subscriptions, toolbar states, etc.)
    await chrome.storage.session.clear();
    console.log('🗑️ Cleared all session storage (account deletion)');

    // Notify all tabs to close Webverse
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: TabLifecycleMessageType.CLOSE_WEBVERSE_ON_LOGOUT
          }).catch(() => {
            // Tab might not have content script loaded, ignore
          });
        }
      }
    } catch (error) {
      console.log('Failed to notify tabs about account deletion:', error);
    }
  } catch (error) {
    console.log('❌ Delete account failed:', error);

    // Check if this is an unauthorized error (401)
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      await chrome.storage.local.set({
        webverse_delete_account_result: {
          success: false,
          logout: true,
          timestamp: Date.now()
        }
      });
      return true;
    }

    await chrome.storage.local.set({
      webverse_delete_account_result: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      }
    });
  }
  return true;
}

// Handle refresh user data request
export async function handleRefreshUserData(message: any, sendResponse: (response?: any) => void) {
  console.log('🔄 Refreshing user data from server...');

  try {
    const { webverse_user_state: userState } = await chrome.storage.local.get('webverse_user_state');

    if (!userState || !userState.isLoggedIn || !userState.token) {
      console.log('⚠️ User not logged in, cannot refresh');
      sendResponse({ success: false, error: 'User not logged in' });
      return true;
    }

    // Call GET /me API
    const userData = await api.getCurrentUser(userState.token);

    if (userData === null) {
      // 401 response - logout user
      console.log('⚠️ User token invalid (401), logging out');
      await chrome.storage.local.remove('webverse_user_state');

      // Clear all session storage (tracked tabs, subscriptions, toolbar states, etc.)
      await chrome.storage.session.clear();
      console.log('🗑️ Cleared all session storage (401 auth error)');

      sendResponse({ success: false, logout: true });
      return true;
    }

    // Check if we should lock the user:
    // 1. KeyVersion increased (password reset in another session)
    // 2. SaltKEK went from non-empty to empty (private layer deleted in another session)
    const keyVersionIncreased = userData.keyVersion > userState.keyVersion;
    const privateLayerDeleted = userState.saltKEK && !userData.saltKEK;

    if (keyVersionIncreased || privateLayerDeleted) {
      const { lockUser } = await import('../encryption/lockHelper');

      if (keyVersionIncreased) {
        await lockUser(`KeyVersion increased from ${userState.keyVersion} to ${userData.keyVersion}`);
      } else if (privateLayerDeleted) {
        await lockUser('Private layer deleted in another session');
      }
    }

    // Update user state with new data, keeping existing token
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

    console.log('✅ User data refreshed');
    sendResponse({ success: true, userData: updatedUserState });
  } catch (error) {
    console.log('❌ Failed to refresh user data:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to refresh user data'
    });
  }
  return true;
}

// Handle auth requests for both GitHub and Google
export async function handleAuthRequest(message: any, sendResponse: (response?: any) => void) {
  const provider = message.provider; // 'github' or 'google'

  // Execute OAuth flow and handle login immediately
  try {
    console.log(`Starting ${provider} OAuth flow...`);
    const redirectUrl = provider === 'github'
      ? await api.launchGitHubOAuth()
      : await api.launchGoogleOAuth();

    console.log('✅ OAuth completed, processing login...');

    await api.processOAuthLogin(provider, redirectUrl);

  } catch (error) {
    // Error already stored in storage by processOAuthLogin
    console.log(`ℹ️ ${provider} login failed:`, error);
  }

  return true; // Keep the message channel open for async response
}
