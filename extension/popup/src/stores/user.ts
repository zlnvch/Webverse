import { defineStore } from 'pinia';
import { UserState } from '@shared/types';
import { UserMessageType } from '@shared/messageTypes';
import { LOCAL_STORAGE_KEYS } from '@shared/storageKeys';

export const useUserStore = defineStore('user', {
  state: (): UserState => ({
    isLoggedIn: false,
    provider: undefined,
    username: undefined,
    id: undefined,
    token: undefined,
    keyVersion: undefined,
    saltKEK: undefined,
    encryptedDEK1: undefined,
    nonceDEK1: undefined,
    encryptedDEK2: undefined,
    nonceDEK2: undefined
  }),

  actions: {
    async loadState() {
      const result = await chrome.storage.local.get(LOCAL_STORAGE_KEYS.USER_STATE);
      const state = result[LOCAL_STORAGE_KEYS.USER_STATE] as UserState | undefined;
      if (state) {
        this.$patch(state);
      }
    },

    // Listen for storage changes from background script
    listenToStorageChanges() {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes[LOCAL_STORAGE_KEYS.USER_STATE]) {
          const newState = changes[LOCAL_STORAGE_KEYS.USER_STATE].newValue as UserState | undefined;
          if (newState) {
            this.$patch(newState);
          } else {
            // State was removed (logout)
            this.$reset();
          }
        }
      });
    },

    async login(provider: 'google' | 'github') {
      try {
        console.log(`=== ${provider.charAt(0).toUpperCase() + provider.slice(1)} OAuth Started ===`);
        console.log('Testing basic Chrome extension API...');

        // Test basic Chrome API availability
        if (!chrome.runtime) {
          throw new Error('Chrome runtime API not available');
        }

        console.log('Chrome runtime available, starting OAuth...');

        // Clear any old login data
        await chrome.storage.local.remove(LOCAL_STORAGE_KEYS.LOGIN_DATA);

        // Set up storage change listener for login completion
        const setupLoginListener = () => {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              chrome.storage.onChanged.removeListener(loginListener);
              reject(new Error('Login completion timeout - please try again'));
            }, 30000); // 30 seconds timeout

            const loginListener = (changes: any, namespace: string) => {
              if (namespace === 'local' && changes[LOCAL_STORAGE_KEYS.LOGIN_DATA]) {
                clearTimeout(timeout);
                chrome.storage.onChanged.removeListener(loginListener);

                const loginResult = changes[LOCAL_STORAGE_KEYS.LOGIN_DATA].newValue;
                console.log('✅ Login result detected via storage change:', loginResult);

                // Clear the stored result
                chrome.storage.local.remove(LOCAL_STORAGE_KEYS.LOGIN_DATA);

                if (loginResult.success) {
                  resolve(loginResult.data);
                } else {
                  reject(new Error(loginResult.error));
                }
              }
            };

            chrome.storage.onChanged.addListener(loginListener);
            console.log('👂 Login storage listener active - waiting for login completion...');
          });
        };

        // Start the login listener
        const loginPromise = setupLoginListener();

        // Send OAuth request to background with provider
        console.log(`Sending ${provider} OAuth request to background...`);

        try {
          await chrome.runtime.sendMessage({
            type: UserMessageType.OAUTH_REQUEST,
            provider
          });
        } catch (error) {
          if (error instanceof Error) {
            console.log('❓ Background message error (popup may close during OAuth):', error.message);
          } else {
            console.log('❓ Background message error (popup may close during OAuth):', String(error));
          }
        }

        // Wait for login completion via storage change event
        console.log('⏳ OAuth request sent, waiting for login completion...');

        const loginData = await loginPromise as any;
        console.log('✅ Login completed via storage listener!');
        this.handleLoginSuccess(loginData);

      } catch (error) {
        console.error(`❌ ${provider} OAuth error:`, error);
        throw error; // Re-throw to let LoginView handle the error display
      }
    },

    handleLoginSuccess(loginData: any) {
      console.log('🎉 Login successful!');
      console.log('📦 Login data:', loginData);

      // Extract user data from backend response
      const {
        provider,
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

      console.log(`👤 Logged in as ${username} (${provider})`);

      // Update store with real user data
      this.$patch({
        isLoggedIn: true,
        provider,
        username,
        token, // Store JWT token
        id,
        keyVersion,
        saltKEK,
        encryptedDEK1,
        nonceDEK1,
        encryptedDEK2,
        nonceDEK2
      });

      console.log('✅ User state updated (background saved to storage)');
    },

    logout() {
      this.$reset();
      chrome.storage.local.remove(LOCAL_STORAGE_KEYS.USER_STATE);
    }
  }
});