<template>
  <div class="disable-private-layer-view">
    <h2 class="title">Disable Private Layer?</h2>

    <p class="warning">
      Disabling the private layer will permanently delete all of your private layer annotations.
      This action is irreversible.
    </p>

    <div class="actions">
      <button
        class="cancel-btn"
        @click="cancel"
        :disabled="isDisabling"
      >
        Cancel
      </button>
      <button
        class="confirm-btn"
        @click="confirmDisable"
        :disabled="isDisabling"
      >
        {{ isDisabling ? 'Disabling...' : 'Confirm' }}
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useUserStore } from '../stores/user';
import { EncryptionMessageType } from '@shared/messageTypes';
import { LOCAL_STORAGE_KEYS } from '@shared/storageKeys';

const emit = defineEmits<{
  cancel: [];
  complete: [];
}>();

const userStore = useUserStore();

const error = ref<string | null>(null);
const isDisabling = ref(false);

const cancel = () => {
  error.value = null;
  emit('cancel');
};

const confirmDisable = async () => {
  error.value = null;
  isDisabling.value = true;

  try {
    // Set up storage listener for disable result
    const disablePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.storage.onChanged.removeListener(disableListener);
        reject(new Error('Disable private layer timeout - please try again'));
      }, 30000);

      const disableListener = (changes: any, namespace: string) => {
        if (namespace === 'local' && changes[LOCAL_STORAGE_KEYS.DISABLE_PRIVATE_LAYER_RESULT]) {
          clearTimeout(timeout);
          chrome.storage.onChanged.removeListener(disableListener);

          const result = changes[LOCAL_STORAGE_KEYS.DISABLE_PRIVATE_LAYER_RESULT].newValue;

          // Clear the stored result
          chrome.storage.local.remove(LOCAL_STORAGE_KEYS.DISABLE_PRIVATE_LAYER_RESULT);

          if (result.success) {
            resolve(result);
          } else {
            reject(new Error(result.error || 'Failed to disable private layer'));
          }
        }
      };

      chrome.storage.onChanged.addListener(disableListener);
    });

    // Send disable request to background
    await chrome.runtime.sendMessage({ type: EncryptionMessageType.DISABLE_PRIVATE_LAYER });

    // Wait for disable completion via storage change event
    const result = await disablePromise as any;

    // Update user store with new data
    if (result.userData) {
      userStore.$patch(result.userData);
    }

    emit('complete');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to disable private layer';
  } finally {
    isDisabling.value = false;
  }
};
</script>

<style scoped>
.disable-private-layer-view {
  padding: 16px;
}

.title {
  font-size: 20px;
  font-weight: 600;
  color: #dc2626;
  margin: 0 0 16px;
  text-align: center;
}

.warning {
  font-size: 14px;
  color: #666;
  line-height: 1.5;
  margin: 0 0 20px;
  text-align: left;
}

.error {
  font-size: 13px;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 10px;
  margin: 16px 0 0;
  text-align: center;
}

.actions {
  display: flex;
  gap: 12px;
}

.cancel-btn,
.confirm-btn {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn {
  background: #f3f4f6;
  color: #374151;
}

.cancel-btn:hover:not(:disabled) {
  background: #e5e7eb;
}

.confirm-btn {
  background: #dc2626;
  color: white;
}

.confirm-btn:hover:not(:disabled) {
  background: #b91c1c;
}

.cancel-btn:disabled,
.confirm-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
