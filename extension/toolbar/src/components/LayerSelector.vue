<template>
  <div class="layer-selector">
    <button
      v-for="layer in layers"
      :key="layer.value"
      :class="['layer-btn', { active: isLayerActive(layer.value), disabled: layer.disabled }]"
      @click="selectLayer(layer.value)"
      :title="layer.tooltip"
      :disabled="layer.disabled"
    >
      <span class="layer-icon">{{ layer.icon }}</span>
      <span>{{ layer.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useToolbarStore } from '../stores/toolbar';
import { Layer } from '@shared/types';
import {
  WindowMessageType,
  EncryptionMessageType,
  LayerMessageType
} from '@shared/messageTypes';

const toolbarStore = useToolbarStore();
const isPrivateLayerUnlocked = ref(false);

// Check encryption status via background script (through content script)
const checkEncryptionStatus = () => {
  // Generate a unique message ID
  const messageId = `check_encryption_${Date.now()}_${Math.random()}`;

  // Listen for response
  const responseHandler = (event: MessageEvent) => {
    if (event.data.type === WindowMessageType.WEBVERSE_TOOLBAR_RESPONSE && event.data.messageId === messageId) {
      window.removeEventListener('message', responseHandler);
      isPrivateLayerUnlocked.value = event.data.response?.isUnlocked || false;
    }
  };

  window.addEventListener('message', responseHandler);

  // Send message to content script which will forward to background
  window.postMessage({
    type: WindowMessageType.WEBVERSE_TOOLBAR_TO_BACKGROUND,
    messageId,
    message: { type: EncryptionMessageType.GET_ENCRYPTION_STATUS }
  }, '*');
};

// Listen for encryption status updates from background
const statusUpdateHandler = (event: MessageEvent) => {
  if (event.data.type === WindowMessageType.WEBVERSE_ENCRYPTION_STATUS_UPDATE) {
    isPrivateLayerUnlocked.value = event.data.isUnlocked;
  }
};

onMounted(() => {
  checkEncryptionStatus();
  window.addEventListener('message', statusUpdateHandler);
});

onUnmounted(() => {
  window.removeEventListener('message', statusUpdateHandler);
});

// Reactive layers array
const layers = computed(() => [
  {
    value: 'public',
    label: 'Public',
    tooltip: 'Everyone\'s annotations',
    icon: '🌐',
    disabled: false
  },
  {
    value: 'mine',
    label: 'Mine',
    tooltip: 'Your public annotations',
    icon: '👤',
    disabled: false
  },
  {
    value: 'private',
    label: 'Private',
    tooltip: isPrivateLayerUnlocked.value ? 'Your private annotations' : 'Private Layer is locked',
    icon: '🔒',
    disabled: !isPrivateLayerUnlocked.value
  }
]);

const isLayerActive = (layerValue: string) => {
  if (layerValue === 'public') {
    return toolbarStore.currentLayer === Layer.Public && !toolbarStore.showMineOnly;
  } else if (layerValue === 'mine') {
    return toolbarStore.currentLayer === Layer.Public && toolbarStore.showMineOnly;
  } else if (layerValue === 'private') {
    return toolbarStore.currentLayer === Layer.Private;
  }
  return false;
};

const selectLayer = async (layerValue: string) => {
  if (layerValue === 'private' && !isPrivateLayerUnlocked.value) {
    return; // Don't allow selection if locked
  }

  const currentLayer = toolbarStore.currentLayer;
  const isCurrentlyPrivate = currentLayer === Layer.Private;
  const targetIsPrivate = layerValue === 'private';

  // If currently on Private layer, any switch requires backend involvement
  // to switch back to Public layer first
  if (isCurrentlyPrivate) {
    if (targetIsPrivate) {
      // Already on Private - do nothing
      return;
    }

    // Tell content script to pause rendering IMMEDIATELY (direct message)
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: { type: LayerMessageType.START_LAYER_SWITCH }
    }, '*');

    // Update toolbar state FIRST before sending SWITCH_LAYER message
    // This ensures trackingTabs has the correct state when switchTabLayer sends YOUR_TAB_ID back
    toolbarStore.setLayer(Layer.Public);

    // Now set showMineOnly
    if (layerValue === 'mine') {
      toolbarStore.setShowMineOnly(true);
    } else {
      toolbarStore.setShowMineOnly(false);
    }

    // NOW send the SWITCH_LAYER message (after toolbar state is updated)
    // Include the current toolbar state so it's used instead of stale state from storage
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR_TO_BACKGROUND,
      messageId: `switch_layer_${Date.now()}_${Math.random()}`,
      message: {
        type: LayerMessageType.SWITCH_LAYER,
        canonicalUrl: window.location.href,
        layer: Layer.Public,
        keyVersion: '',
        toolbarState: {
          layer: toolbarStore.currentLayer,
          showMineOnly: toolbarStore.showMineOnly,
          tool: toolbarStore.currentTool,
          color: toolbarStore.currentColor,
          width: toolbarStore.currentWidth
        }
      }
    }, '*');
  } else if (targetIsPrivate) {
    // Tell content script to pause rendering IMMEDIATELY (direct message)
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: { type: LayerMessageType.START_LAYER_SWITCH }
    }, '*');

    // Currently on Public/Mine, switching to Private
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR_TO_BACKGROUND,
      messageId: `switch_layer_${Date.now()}_${Math.random()}`,
      message: {
        type: LayerMessageType.SWITCH_LAYER,
        canonicalUrl: window.location.href,
        layer: Layer.Private,
        keyVersion: ''
      }
    }, '*');

    toolbarStore.setLayer(Layer.Private);
    // Don't change showMineOnly - Private layer only shows your strokes anyway
  } else {
    // Just switching between Public and Mine - no backend needed
    if (layerValue === 'public') {
      toolbarStore.setShowMineOnly(false);
    } else if (layerValue === 'mine') {
      toolbarStore.setShowMineOnly(true);
    }
  }

  // console.log('Layer changed to:', layerValue);
};
</script>

<script lang="ts">
const GlobeIcon = {
  template: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="2" y1="12" x2="22" y2="12"></line>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
  </svg>`
};

const UserIcon = {
  template: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>`
};

const LockIcon = {
  template: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>`
};

export default {
  components: { GlobeIcon, UserIcon, LockIcon }
};
</script>

<style scoped>
/* Increased specificity with where needed */
.layer-selector {
  display: flex;
  gap: 4px;
  margin-right: 12px;
  border-right: 1px solid #e0e0e0;
  padding-right: 12px;
  cursor: inherit;
}

.layer-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 3px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 55px;
  min-height: 47px; /* Reduced from 55px (8px padding reduction) */
  box-sizing: border-box;
  color: #333; /* Explicit default text color */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
}

.layer-btn:hover:not(.disabled) {
  background: #f5f5f5;
}

.layer-btn.active {
  background: #e3f2fd;
  color: #1976d2;
}

.layer-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.layer-btn.disabled:hover {
  background: transparent;
}

.layer-btn span:not(.layer-icon) {
  font-size: 12px;
  line-height: 1;
  font-weight: 500;
  color: inherit;
}

.layer-icon {
  font-size: 20px;
  display: block;
  line-height: 1;
}
</style>