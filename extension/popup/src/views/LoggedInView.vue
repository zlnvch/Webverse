<template>
  <div class="logged-in-view">
    <div class="logo-container">
      <img :src="webverseLogo" alt="Webverse" class="webverse-logo" />
    </div>

    <div class="user-info">
      <div class="avatar">
        <svg v-if="userStore.provider === 'google'" width="24" height="24" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      </div>
      <div class="user-text">
        <p class="welcome">Logged in as</p>
        <p class="username">{{ userStore.username }}</p>
      </div>
      <!-- Encryption status icon -->
      <div v-if="userStore.saltKEK" class="encryption-icon">
        <svg v-if="isPrivateLayerUnlocked" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
        </svg>
        <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </div>
    </div>

    <div class="actions">
      <button
        class="launch-btn"
        :disabled="!webverseStore.canLaunch || webverseStore.isLaunched"
        @click="webverseStore.launchWebverse()"
      >
        {{ webverseStore.isLaunched ? 'Webverse Active' : 'Launch Webverse' }}
      </button>
      <p v-if="!webverseStore.canLaunch" class="cannot-launch">
        Webverse cannot be launched on this page
      </p>
      <button
        :class="['private-layer-btn', { 'private-layer-btn-lock': isPrivateLayerUnlocked }]"
        @click="handlePrivateLayer"
      >
        <svg v-if="userStore.saltKEK && isPrivateLayerUnlocked" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; vertical-align: text-bottom;">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <svg v-else-if="userStore.saltKEK" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; vertical-align: text-bottom;">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
        </svg>
        {{ privateLayerButtonText }}
      </button>

      <!-- Change Password button (only shown when unlocked) -->
      <button
        v-if="userStore.saltKEK"
        class="change-password-btn"
        @click="handleChangePassword"
        :disabled="!isPrivateLayerUnlocked"
        :title="!isPrivateLayerUnlocked ? 'Unlock private layer first' : ''"
      >
        Change Private Layer Password
      </button>
    </div>

    <button class="logout-btn" @click="logout">
      Logout
    </button>

    <div class="danger-zone">
      <div class="danger-zone-header">Danger Zone</div>
      <button
        v-if="userStore.saltKEK"
        class="disable-private-btn"
        @click="handleDisablePrivateLayer"
      >
        Disable Private Layer
      </button>
      <button class="delete-account-btn" @click="$emit('delete-account')">
        Delete Account
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useUserStore } from '../stores/user';
import { useWebverseStore } from '../stores/webverse';
import webverseLogo from '../assets/webverse_logo_no_text.png';
import { EncryptionMessageType, UserMessageType } from '@shared/messageTypes';

const emit = defineEmits<{
  deleteAccount: [];
  privateLayer: [];
  changePassword: [];
  disablePrivateLayer: [];
}>();

const userStore = useUserStore();
const webverseStore = useWebverseStore();

// Local ref to track actual encryption status
const isPrivateLayerUnlocked = ref(false);

// Function to check encryption status from session storage
const checkEncryptionStatus = async () => {
  // If saltKEK is not set, private layer is not enabled
  if (!userStore.saltKEK || userStore.saltKEK === null) {
    isPrivateLayerUnlocked.value = false;
    return;
  }

  try {
    // Read directly from session storage (shared across extension)
    const result = await chrome.storage.session.get(['DEK1', 'DEK2']);
    const isUnlocked = !!(result.DEK1 && result.DEK2);
    isPrivateLayerUnlocked.value = isUnlocked;
  } catch (error) {
    console.log('Failed to check encryption status:', error);
    isPrivateLayerUnlocked.value = false;
  }
};

// Listen for session storage changes (DEK1/DEK2) and initial check
onMounted(() => {
  checkEncryptionStatus();

  // Watch for changes to DEK1/DEK2 in session storage
  const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'session' && (changes.DEK1 || changes.DEK2)) {
      checkEncryptionStatus();
    }
  };

  chrome.storage.onChanged.addListener(storageListener);

  // Clean up listener on unmount
  onUnmounted(() => {
    chrome.storage.onChanged.removeListener(storageListener);
  });
});

const privateLayerButtonText = computed(() => {
  if (!userStore.saltKEK) {
    return 'Enable Private Layer';
  }
  return isPrivateLayerUnlocked.value ? 'Lock Private Layer' : 'Unlock Private Layer';
});

const handlePrivateLayer = async () => {
  if (isPrivateLayerUnlocked.value) {
    // Lock the private layer
    try {
      await chrome.runtime.sendMessage({ type: EncryptionMessageType.LOCK_ENCRYPTION });
      // Update state immediately - we know it's locked
      isPrivateLayerUnlocked.value = false;
    } catch (error) {
      console.log('Failed to lock encryption:', error);
    }
  } else {
    // Show setup/unlock view
    emit('privateLayer');
  }
};

const handleChangePassword = () => {
  // Emit change-password event to open PrivateLayerView in change password mode
  emit('changePassword');
};

const handleDisablePrivateLayer = () => {
  // Emit event to show DisablePrivateLayerView
  emit('disablePrivateLayer');
};

const logout = async () => {
  // Clear encryption keys from session storage
  try {
    await chrome.storage.session.remove(['DEK1', 'DEK2']);
  } catch (error) {
    console.log('Failed to clear encryption keys:', error);
  }

  // Send logout message to background to close WebSocket and notify all tabs
  try {
    await chrome.runtime.sendMessage({ type: UserMessageType.USER_LOGOUT });
  } catch (error) {
    console.log('Failed to send logout to background:', error);
  }

  userStore.logout();
  webverseStore.isLaunched = false;
};
</script>

<style scoped>
.logged-in-view {
  padding: 16px;
}

.logo-container {
  text-align: center;
  margin-bottom: 16px;
}

.webverse-logo {
  width: 120px;
  height: auto;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  padding: 12px;
  padding-right: 48px;
  background: #f8f9fa;
  border-radius: 12px;
  position: relative;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.user-text {
  flex: 1;
  text-align: left;
}

.welcome {
  font-size: 12px;
  color: #666;
  margin: 0 0 4px;
}

.username {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
}

.encryption-icon {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.actions {
  margin-bottom: 12px;
}

.launch-btn {
  width: 100%;
  padding: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.launch-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.launch-btn:disabled {
  background: #e0e0e0;
  color: #999;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.cannot-launch {
  font-size: 12px;
  color: #666;
  text-align: center;
  margin: 8px 0 0;
}

.logout-btn {
  width: 100%;
  padding: 8px;
  background: transparent;
  color: #666;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.logout-btn:hover {
  background: #f8f9fa;
  color: #333;
}

.delete-account-btn {
  width: 100%;
  padding: 8px;
  background: transparent;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.delete-account-btn:hover {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fca5a5;
}

.private-layer-btn {
  width: 100%;
  padding: 10px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 8px;
}

.private-layer-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.private-layer-btn-lock {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
}

.private-layer-btn-lock:hover {
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
}

.change-password-btn {
  width: 100%;
  padding: 10px;
  background: transparent;
  color: #666;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 8px;
}

.change-password-btn:hover:not(:disabled) {
  background: #f8f9fa;
  color: #333;
}

.change-password-btn:disabled {
  background: transparent;
  color: #ccc;
  cursor: not-allowed;
  border-color: #eee;
}

.danger-zone {
  border: 1px solid #dc2626;
  border-radius: 8px;
  padding: 12px;
  margin-top: 16px;
}

.danger-zone-header {
  font-size: 12px;
  font-weight: 600;
  color: #dc2626;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  text-align: center;
}

.disable-private-btn {
  width: 100%;
  padding: 8px;
  background: transparent;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 8px;
}

.disable-private-btn:hover {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fca5a5;
}
</style>