<template>
  <div class="delete-account-view">
    <h2 class="title">Delete Account?</h2>

    <p class="warning">
      Deleting your account will remove all of the annotations you have made.
      This action is irreversible.
    </p>

    <div class="actions">
      <button
        class="cancel-btn"
        @click="cancel"
        :disabled="isDeleting"
      >
        Cancel
      </button>
      <button
        class="confirm-btn"
        @click="confirmDelete"
        :disabled="isDeleting"
      >
        {{ isDeleting ? 'Deleting...' : 'Confirm' }}
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useUserStore } from '../stores/user';
import { useWebverseStore } from '../stores/webverse';
import { UserMessageType } from '@shared/messageTypes';
import { LOCAL_STORAGE_KEYS } from '@shared/storageKeys';

const emit = defineEmits<{
  cancel: [];
  complete: [];
}>();

const userStore = useUserStore();
const webverseStore = useWebverseStore();

const error = ref<string | null>(null);
const isDeleting = ref(false);

const cancel = () => {
  error.value = null;
  emit('cancel');
};

const confirmDelete = async () => {
  error.value = null;
  isDeleting.value = true;

  try {
    // Set up storage listener for delete result
    const deletePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.storage.onChanged.removeListener(deleteListener);
        reject(new Error('Delete account timeout - please try again'));
      }, 30000); // 30 seconds timeout

      const deleteListener = (changes: any, namespace: string) => {
        if (namespace === 'local' && changes[LOCAL_STORAGE_KEYS.DELETE_ACCOUNT_RESULT]) {
          clearTimeout(timeout);
          chrome.storage.onChanged.removeListener(deleteListener);

          const result = changes[LOCAL_STORAGE_KEYS.DELETE_ACCOUNT_RESULT].newValue;

          // Clear the stored result
          chrome.storage.local.remove(LOCAL_STORAGE_KEYS.DELETE_ACCOUNT_RESULT);

          if (result.success) {
            resolve(result);
          } else {
            reject(new Error(result.error || 'Failed to delete account'));
          }
        }
      };

      chrome.storage.onChanged.addListener(deleteListener);
    });

    // Send delete request to background
    await chrome.runtime.sendMessage({ type: UserMessageType.DELETE_ACCOUNT });

    // Wait for delete completion via storage change event
    await deletePromise;

    // Logout and clean up
    userStore.logout();
    webverseStore.isLaunched = false;
    emit('complete');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete account';
  } finally {
    isDeleting.value = false;
  }
};
</script>

<style scoped>
.delete-account-view {
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
