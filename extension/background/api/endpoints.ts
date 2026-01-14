import { GITHUB_AUTH_CONFIG, GOOGLE_AUTH_CONFIG, API_BASE_URL } from '../../shared/constants';
import { connectWebSocket, cleanup } from '../websocket';

// Helper function to handle API errors (supports both JSON and plain text)
async function handleApiError(response: Response): Promise<never> {
  const responseText = await response.text();
  let errorMessage = response.statusText;

  try {
    const errorData = JSON.parse(responseText);
    errorMessage = errorData.message || errorData.error || response.statusText;
  } catch {
    // Not JSON, use the text directly
    errorMessage = responseText || response.statusText;
  }
  throw new Error(errorMessage);
}

// Launch GitHub OAuth flow
export async function launchGitHubOAuth(): Promise<string> {
  return new Promise((resolve, reject) => {
    const authUrl = new URL(GITHUB_AUTH_CONFIG.authUrl);
    authUrl.searchParams.append('client_id', GITHUB_AUTH_CONFIG.clientId);
    authUrl.searchParams.append('redirect_uri', GITHUB_AUTH_CONFIG.redirectUri);
    authUrl.searchParams.append('scope', GITHUB_AUTH_CONFIG.scope);

    console.log('Starting GitHub OAuth flow with URL:', authUrl.toString());
    console.log('Redirect URI:', GITHUB_AUTH_CONFIG.redirectUri);

    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl.toString(),
        interactive: true
      },
      function (redirectUrl) {
        console.log('launchWebAuthFlow callback executed');
        console.log('chrome.runtime.lastError:', chrome.runtime.lastError);
        console.log('redirectUrl:', redirectUrl);

        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError;
          console.log('ℹ️ OAuth flow cancelled by user:', {
            message: error.message,
            details: JSON.stringify(error, null, 2)
          });

          // Handle specific error cases
          if (error.message?.includes('user did not approve access')) {
            reject(new Error('User cancelled or denied access'));
          } else if (error.message?.includes('redirect_url_mismatch')) {
            reject(new Error('Redirect URI mismatch - check GitHub app settings'));
          } else {
            reject(new Error(`OAuth failed: ${error.message}`));
          }
          return;
        }

        if (!redirectUrl) {
          console.log('ℹ️ No redirect URL received - user cancelled the authorization');
          reject(new Error('User cancelled the authorization'));
          return;
        }

        console.log('✅ OAuth redirect URL received:', redirectUrl);
        resolve(redirectUrl);
      }
    );
  });
}

// Launch Google OAuth flow
export async function launchGoogleOAuth(): Promise<string> {
  return new Promise((resolve, reject) => {
    const authUrl = new URL(GOOGLE_AUTH_CONFIG.authUrl);
    authUrl.searchParams.append('client_id', GOOGLE_AUTH_CONFIG.clientId);
    authUrl.searchParams.append('redirect_uri', GOOGLE_AUTH_CONFIG.redirectUri);
    authUrl.searchParams.append('scope', GOOGLE_AUTH_CONFIG.scope);
    authUrl.searchParams.append('response_type', 'code');

    console.log('Starting Google OAuth flow with URL:', authUrl.toString());
    console.log('Redirect URI:', GOOGLE_AUTH_CONFIG.redirectUri);

    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl.toString(),
        interactive: true
      },
      function (redirectUrl) {
        console.log('launchWebAuthFlow callback executed');
        console.log('chrome.runtime.lastError:', chrome.runtime.lastError);
        console.log('redirectUrl:', redirectUrl);

        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError;
          console.log('ℹ️ OAuth flow cancelled by user:', {
            message: error.message,
            details: JSON.stringify(error, null, 2)
          });

          // Handle specific error cases
          if (error.message?.includes('user did not approve access')) {
            reject(new Error('User cancelled or denied access'));
          } else if (error.message?.includes('redirect_url_mismatch')) {
            reject(new Error('Redirect URI mismatch - check Google app settings'));
          } else {
            reject(new Error(`OAuth failed: ${error.message}`));
          }
          return;
        }

        if (!redirectUrl) {
          console.log('ℹ️ No redirect URL received - user cancelled the authorization');
          reject(new Error('User cancelled the authorization'));
          return;
        }

        console.log('✅ OAuth redirect URL received:', redirectUrl);
        resolve(redirectUrl);
      }
    );
  });
}

// Process OAuth login
export async function processOAuthLogin(provider: 'github' | 'google', redirectUrl: string): Promise<void> {
  try {
    // Extract authorization code from redirect URL
    const urlParams = new URLSearchParams(redirectUrl.split('?')[1] || '');
    const authCode = urlParams.get('code');

    if (!authCode) {
      throw new Error('No authorization code found in redirect URL');
    }

    console.log(`🔑 ${provider} authorization code extracted:`, authCode);

    // Call backend login API
    console.log('🔄 Calling backend login API...');
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: authCode,
        provider: provider
      })
    }).catch((error) => {
      // Catch network errors (e.g., server is down)
      throw new Error('Cannot reach the server. Please try again later!');
    });

    console.log(`📡 Backend response status for ${provider}:`, response.status);

    if (!response.ok) {
      return handleApiError(response);
    }

    const loginData = await response.json();
    console.log(`📦 Backend ${provider} login response:`, loginData);

    // Extract user data
    const {
      provider: dataProvider,
      token,
      username,
      id,
      keyVersion,
      saltKEK,
      encryptedDEK1,
      nonceDEK1,
      encryptedDEK2,
      nonceDEK2
    } = loginData;

    // Store webverse_login_data for popup to read
    await chrome.storage.local.set({
      webverse_login_data: {
        success: true,
        data: loginData,
        timestamp: Date.now()
      }
    });

    // Also store webverse_user_state immediately so WebSocket can connect
    await chrome.storage.local.set({
      webverse_user_state: {
        isLoggedIn: true,
        provider: dataProvider,
        token,
        username,
        id,
        keyVersion,
        saltKEK,
        encryptedDEK1,
        nonceDEK1,
        encryptedDEK2,
        nonceDEK2
      }
    });

    // Connect WebSocket after successful login
    console.log('🔄 Connecting WebSocket after login...');
    await connectWebSocket();

  } catch (error) {
    console.log(`ℹ️ ${provider} login failed:`, error);

    // Store error in storage
    await chrome.storage.local.set({
      webverse_login_data: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      }
    });

    throw error;
  }
}

// Delete user account
export async function deleteAccount(userId: string, token: string): Promise<void> {
  console.log('🗑️ Deleting account for user:', userId);

  const response = await fetch(`${API_BASE_URL}/me`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }).catch((error) => {
    // Catch network errors (e.g., server is down)
    throw new Error('Cannot reach the server. Please try again later!');
  });

  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }

  console.log(`📡 Backend delete response status:`, response.status);

  if (!response.ok) {
    return handleApiError(response);
  }

  const result = await response.json();
  console.log('📦 Backend delete response:', result);

  if (!result.success) {
    throw new Error('Delete account failed');
  }

  console.log('✅ Account deleted successfully');

  // Clear user state
  await chrome.storage.local.remove('webverse_user_state');

  // Close WebSocket connection
  cleanup();
}

// Get current user data from server
export async function getCurrentUser(token: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/me`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }).catch((error) => {
    // Catch network errors (e.g., server is down)
    throw new Error('Cannot reach the server. Please try again later!');
  });

  if (response.status === 401) {
    // Token is invalid or expired
    return null;
  }

  if (!response.ok) {
    return handleApiError(response);
  }

  return await response.json();
}

// Setup encryption keys (POST /me/encryption-keys)
export async function setupEncryptionKeys(
  token: string,
  saltKEK: string,
  encryptedDEK1: string,
  nonceDEK1: string,
  encryptedDEK2: string,
  nonceDEK2: string
): Promise<{ success: boolean; keyVersion: number }> {
  const response = await fetch(`${API_BASE_URL}/me/encryption-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      saltKEK,
      encryptedDEK1,
      nonceDEK1,
      encryptedDEK2,
      nonceDEK2
    })
  }).catch((error) => {
    throw new Error('Cannot reach the server. Please try again later!');
  });

  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    return handleApiError(response);
  }

  return await response.json();
}

// Change encryption password (PUT /me/encryption-keys)
export async function changeEncryptionPassword(
  token: string,
  saltKEK: string,
  encryptedDEK1: string,
  nonceDEK1: string,
  encryptedDEK2: string,
  nonceDEK2: string
): Promise<{ success: boolean; keyVersion: number }> {
  const response = await fetch(`${API_BASE_URL}/me/encryption-keys`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      saltKEK,
      encryptedDEK1,
      nonceDEK1,
      encryptedDEK2,
      nonceDEK2
    })
  }).catch((error) => {
    throw new Error('Cannot reach the server. Please try again later!');
  });

  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    return handleApiError(response);
  }

  return await response.json();
}

// Disable private layer (DELETE /me/encryption-keys)
export async function disablePrivateLayer(token: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/me/encryption-keys`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }).catch((error) => {
    throw new Error('Cannot reach the server. Please try again later!');
  });

  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    return handleApiError(response);
  }

  return await response.json();
}
