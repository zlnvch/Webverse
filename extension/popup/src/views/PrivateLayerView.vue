<template>
  <div class="private-layer-view">
    <h2 class="title">{{ isSetup ? 'Enable Private Layer' : (isUnlockMode ? 'Unlock Private Layer' : (isChangeMode ? 'Change Private Layer Password' : 'Reset Private Layer Password')) }}</h2>

    <p class="description">
      {{ isUnlockMode
        ? 'Enter your password to unlock the private layer. Your private canvas will be decrypted and available for drawing.'
        : (isChangeMode
          ? 'Enter your new password to re-encrypt your private layer keys. Your existing private annotations will remain accessible with the new password.'
          : 'The private layer uses end-to-end encryption to protect your private annotations. Your password generates a key that encrypts your annotations on your device before they are sent to our servers. Only you can access them—without your password, not even we can.'
        )
      }}
    </p>

    <p v-if="isReset && !isUnlockMode && !isChangeMode" class="warning">
      <strong>Warning:</strong> Resetting your private layer password will delete all of your existing private annotations.
    </p>

    <form @submit.prevent="handleSubmit">
      <p v-if="!isUnlockMode" class="requirements">
        <strong>Password Requirements:</strong> At least 8 characters and include any 3 of: uppercase, lowercase, numbers, or special characters.
      </p>

      <div v-if="isUnlockMode" class="form-group">
        <label for="password">Password</label>
        <input
          id="password"
          ref="passwordInput"
          v-model="password"
          type="password"
          class="input"
          placeholder="Enter your password"
          autocomplete="current-password"
          :disabled="isLoading"
        />
      </div>

      <template v-else>
        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            ref="passwordInput"
            v-model="password"
            type="password"
            class="input"
            :class="{ 'error': passwordError && passwordBlurred }"
            placeholder="Enter a strong password"
            autocomplete="new-password"
            :disabled="isLoading"
            @blur="handlePasswordBlur"
          />
        </div>

        <div class="form-group">
          <label for="confirmPassword">Confirm Password</label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            class="input"
            :class="{ 'error': confirmPasswordError && (confirmBlurred || submitAttempted) }"
            placeholder="Confirm your password"
            autocomplete="new-password"
            :disabled="isLoading"
            @blur="handleConfirmBlur"
          />
        </div>

        <!-- Single error box with allocated space -->
        <div class="error-box">
          <span v-if="combinedError" class="field-error">{{ combinedError }}</span>
        </div>
      </template>

      <div class="actions">
        <button
          type="submit"
          class="submit-btn"
          :class="{
            'unlock-btn': isUnlockMode || isSetup || isChangeMode,
            'reset-btn': isReset
          }"
          :disabled="isLoading || !isFormValid"
        >
          <span v-if="isLoading">{{ isUnlockMode ? 'Unlocking...' : (isChangeMode ? 'Re-encrypting...' : (isReset ? 'Resetting...' : 'Generating...')) }}</span>
          <span v-else class="btn-content">
            <template v-if="isUnlockMode">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; vertical-align: text-bottom;">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
              </svg>
              Unlock
            </template>
            <template v-else>{{ isChangeMode ? 'Re-encrypt' : (isReset ? 'Reset Encryption Keys' : 'Generate Encryption Keys') }}</template>
          </span>
        </button>

        <p v-if="error && isUnlockMode" class="error action-error">{{ error }}</p>

        <button
          v-if="!isSetup && !showForgotPassword && !isChangeMode"
          type="button"
          class="forgot-btn"
          @click="showForgotPassword = !showForgotPassword"
          :disabled="isLoading"
        >
          Forgot Password?
        </button>

        <button
          type="button"
          class="cancel-btn"
          @click="cancel"
          :disabled="isLoading"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useUserStore } from '../stores/user';
import { useWebverseStore } from '../stores/webverse';
import { EncryptionMessageType, UserMessageType } from '@shared/messageTypes';
import { LOCAL_STORAGE_KEYS } from '@shared/storageKeys';

const props = defineProps<{
  isReset?: boolean;
  isChangePassword?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  complete: [];
}>();

const userStore = useUserStore();
const webverseStore = useWebverseStore();

const password = ref('');
const confirmPassword = ref('');
const isLoading = ref(false);
const error = ref<string | null>(null);
const passwordError = ref<string | null>(null);
const confirmPasswordError = ref<string | null>(null);
const showForgotPassword = ref(props.isReset || false);
const passwordInput = ref<HTMLInputElement | null>(null);
const passwordBlurred = ref(false);
const confirmBlurred = ref(false);
const submitAttempted = ref(false);

// Determine mode
const isSetup = computed(() => !userStore.saltKEK);
const isUnlockMode = computed(() => userStore.saltKEK && !showForgotPassword.value && !props.isChangePassword);
const isReset = computed(() => userStore.saltKEK && showForgotPassword.value);
const isChangeMode = computed(() => props.isChangePassword);

// Watch for mode changes
watch(() => props.isReset, (newValue) => {
  showForgotPassword.value = newValue;
});

// Clear password and error when switching to reset mode
watch(showForgotPassword, (newValue) => {
  if (newValue) {
    // Switching to reset mode - clear password and errors
    password.value = '';
    confirmPassword.value = '';
    error.value = null;
    passwordError.value = null;
    confirmPasswordError.value = null;
    passwordBlurred.value = false;
    confirmBlurred.value = false;
    submitAttempted.value = false;
  }
});

// Validate password strength
const validatePassword = (pwd: string): string | null => {
  if (!pwd) {
    return null; // Empty is OK initially
  }

  if (pwd.length < 8) {
    return 'Password must be at least 8 characters long';
  }

  let categories = 0;
  if (/[a-z]/.test(pwd)) categories++; // lowercase
  if (/[A-Z]/.test(pwd)) categories++; // uppercase
  if (/[0-9]/.test(pwd)) categories++; // numbers
  if (/[^a-zA-Z0-9]/.test(pwd)) categories++; // special chars

  if (categories < 3) {
    return 'Password must include 3 of the following: uppercase letters, lowercase letters, numbers, special characters';
  }

  return null;
};

// Blur handlers that trigger validation immediately
const handlePasswordBlur = () => {
  passwordBlurred.value = true;
  if (!isUnlockMode.value) {
    passwordError.value = validatePassword(password.value);
    if (confirmPassword.value) {
      confirmPasswordError.value = confirmPassword.value !== password.value ? 'Passwords do not match' : null;
    }
  }
};

const handleConfirmBlur = () => {
  confirmBlurred.value = true;
  if (!isUnlockMode.value && confirmPassword.value) {
    confirmPasswordError.value = confirmPassword.value !== password.value ? 'Passwords do not match' : null;
  }
};

// Watch password for validation (only after blur)
watch(password, (newPassword) => {
  if (!isUnlockMode.value && passwordBlurred.value) {
    passwordError.value = validatePassword(newPassword);
    if (confirmPassword.value && (confirmBlurred.value || submitAttempted.value)) {
      confirmPasswordError.value = confirmPassword.value !== newPassword ? 'Passwords do not match' : null;
    }
  }
});

// Watch confirm password (only after blur or submit attempt)
watch(confirmPassword, (newConfirm) => {
  if (!isUnlockMode.value && newConfirm && (confirmBlurred.value || submitAttempted.value)) {
    confirmPasswordError.value = newConfirm !== password.value ? 'Passwords do not match' : null;
  }
});

// Combined error for display (shows first error, respects blur state)
const combinedError = computed(() => {
  if (isUnlockMode.value) return null;

  // Show password error if blurred and has error
  if (passwordBlurred.value && passwordError.value) {
    return passwordError.value;
  }

  // Show confirm error if blurred/submitted and has error
  if ((confirmBlurred.value || submitAttempted.value) && confirmPasswordError.value) {
    return confirmPasswordError.value;
  }

  return null;
});

const isFormValid = computed(() => {
  if (isUnlockMode.value) {
    return password.value.length > 0 && !passwordError.value;
  }
  return (
    password.value.length > 0 &&
    confirmPassword.value.length > 0 &&
    !passwordError.value &&
    !confirmPasswordError.value &&
    password.value === confirmPassword.value
  );
});

const handleSubmit = async () => {
  submitAttempted.value = true;
  error.value = null;
  isLoading.value = true;

  try {
    if (isUnlockMode.value) {
      // Unlock existing encryption - use storage listener
      const unlockPromise = new Promise<{ userData?: any }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.storage.onChanged.removeListener(unlockListener);
          reject(new Error('Unlock timeout - please try again'));
        }, 30000);

        const unlockListener = (changes: any, namespace: string) => {
          if (namespace === 'local' && changes[LOCAL_STORAGE_KEYS.UNLOCK_RESULT]) {
            clearTimeout(timeout);
            chrome.storage.onChanged.removeListener(unlockListener);

            const result = changes[LOCAL_STORAGE_KEYS.UNLOCK_RESULT].newValue;
            chrome.storage.local.remove(LOCAL_STORAGE_KEYS.UNLOCK_RESULT);

            if (result.success) {
              resolve(result);
            } else {
              reject(new Error(result.error));
            }
          }
        };

        chrome.storage.onChanged.addListener(unlockListener);
      });

      // Send unlock request
      await chrome.runtime.sendMessage({
        type: EncryptionMessageType.UNLOCK_ENCRYPTION,
        password: password.value
      });

      await unlockPromise;
      emit('complete');
    } else if (isChangeMode.value) {
      // Change password - use storage listener
      const changePromise = new Promise<{ userData?: any }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.storage.onChanged.removeListener(changeListener);
          reject(new Error('Change password timeout - please try again'));
        }, 30000);

        const changeListener = (changes: any, namespace: string) => {
          if (namespace === 'local' && changes[LOCAL_STORAGE_KEYS.CHANGE_PASSWORD_RESULT]) {
            clearTimeout(timeout);
            chrome.storage.onChanged.removeListener(changeListener);

            const result = changes[LOCAL_STORAGE_KEYS.CHANGE_PASSWORD_RESULT].newValue;
            chrome.storage.local.remove(LOCAL_STORAGE_KEYS.CHANGE_PASSWORD_RESULT);

            if (result.logout) {
              reject(new Error('LOGOUT'));
            } else if (result.success) {
              resolve(result);
            } else {
              reject(new Error(result.error));
            }
          }
        };

        chrome.storage.onChanged.addListener(changeListener);
      });

      // Send change password request
      await chrome.runtime.sendMessage({
        type: EncryptionMessageType.CHANGE_PASSWORD,
        password: password.value
      });

      const response = await changePromise;

      // Update user store with new data (background already saved to storage)
      if (response.userData) {
        userStore.$patch(response.userData);
      }

      emit('complete');
    } else {
      // Setup new encryption or reset password - use storage listener
      const setupPromise = new Promise<{ userData?: any }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.storage.onChanged.removeListener(setupListener);
          reject(new Error('Setup timeout - please try again'));
        }, 30000);

        const setupListener = (changes: any, namespace: string) => {
          if (namespace === 'local' && changes[LOCAL_STORAGE_KEYS.SETUP_ENCRYPTION_RESULT]) {
            clearTimeout(timeout);
            chrome.storage.onChanged.removeListener(setupListener);

            const result = changes[LOCAL_STORAGE_KEYS.SETUP_ENCRYPTION_RESULT].newValue;
            chrome.storage.local.remove(LOCAL_STORAGE_KEYS.SETUP_ENCRYPTION_RESULT);

            if (result.logout) {
              reject(new Error('LOGOUT'));
            } else if (result.success) {
              resolve(result);
            } else {
              reject(new Error(result.error));
            }
          }
        };

        chrome.storage.onChanged.addListener(setupListener);
      });

      // Send setup request
      await chrome.runtime.sendMessage({
        type: EncryptionMessageType.SETUP_ENCRYPTION,
        password: password.value,
        isReset: isReset.value
      });

      const response = await setupPromise;

      // Update user store with new data (background already saved to storage)
      if (response.userData) {
        userStore.$patch(response.userData);
      }

      emit('complete');
    }
  } catch (err) {
    // Check if this is a logout error
    if (err instanceof Error && err.message === 'LOGOUT') {
      userStore.logout();
      webverseStore.isLaunched = false;
    } else {
      error.value = err instanceof Error ? err.message : 'An error occurred';
    }
  } finally {
    isLoading.value = false;
  }
};

const cancel = () => {
  emit('cancel');
};

// Focus password input on mount
onMounted(async () => {
  // Refresh user data from server to get latest encryption keys
  // This ensures we have the latest state if password was changed in another session
  if (userStore.isLoggedIn && userStore.token) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: UserMessageType.REFRESH_USER_DATA
      }) as { logout?: boolean; success?: boolean; userData?: any } | undefined;

      if (response?.logout) {
        // Token was invalid (401), logout user
        userStore.logout();
        webverseStore.isLaunched = false;
        emit('cancel');
        return;
      } else if (response?.success && response?.userData) {
        // Background already saved to storage, just patch the store
        userStore.$patch(response.userData);
      }
    } catch (error) {
      console.log('Failed to refresh user data:', error);
    }
  }

  nextTick(() => {
    passwordInput.value?.focus();
  });
});
</script>

<style scoped>
.private-layer-view {
  padding: 16px;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0 0 12px;
}

.description {
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  margin: 0 0 12px;
}

.warning {
  font-size: 13px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 10px;
  margin: 0 0 16px;
}

.error {
  font-size: 13px;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 10px;
  margin: 0 0 16px;
  text-align: center;
}

.error.action-error {
  margin: 0;
}

.form-group {
  margin-bottom: 5px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 4px;
}

.input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.input.error {
  border-color: #dc2626;
  margin: 0;
  text-align: left;
}

.input:disabled {
  background: #f3f4f6;
  cursor: not-allowed;
}

.field-error {
  display: block;
  font-size: 12px;
  color: #dc2626;
  margin-top: 4px;
}

.error-box {
  min-height: 32px;
  margin: 0 0 5px;
  padding: 0;
}

.error-box .field-error {
  margin: 0;
}

.requirements {
  font-size: 12px;
  color: #6b7280;
  margin: 0 0 10px;
  line-height: 1.4;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.submit-btn {
  width: 100%;
  padding: 10px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.submit-btn.unlock-btn {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.submit-btn.reset-btn {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.submit-btn.unlock-btn:hover:not(:disabled) {
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.submit-btn.reset-btn:hover:not(:disabled) {
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
}

.submit-btn:disabled {
  background: #93c5fd;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.submit-btn.unlock-btn:disabled {
  background: #81cbb1;
}

.submit-btn.reset-btn:disabled {
  background: #fca5a5;
}

.forgot-btn {
  width: 100%;
  padding: 8px;
  background: transparent;
  color: #3b82f6;
  border: none;
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
}

.forgot-btn:hover:not(:disabled) {
  color: #2563eb;
}

.forgot-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancel-btn {
  width: 100%;
  padding: 8px;
  background: transparent;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn:hover:not(:disabled) {
  background: #f3f4f6;
  color: #374151;
}

.cancel-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
