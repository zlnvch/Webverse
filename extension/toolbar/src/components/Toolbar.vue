<template>
  <div
    class="toolbar"
    :style="{ left: toolbarStore.position.x + 'px', top: toolbarStore.position.y + 'px' }"
  >
    <div class="toolbar-header" @mousedown="startDrag">
      <LayerSelector />
      <ToolSelector />
      <div class="width-color-section">
        <WidthSlider />
        <ColorPicker />
      </div>
      <UndoRedo />
      <button class="close-btn" @click="closeToolbar" title="Close toolbar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import LayerSelector from './LayerSelector.vue';
import ToolSelector from './ToolSelector.vue';
import WidthSlider from './WidthSlider.vue';
import ColorPicker from './ColorPicker.vue';
import UndoRedo from './UndoRedo.vue';
import { useToolbarStore } from '../stores/toolbar';
import { WindowMessageType, ToolbarMessageType } from '@shared/messageTypes';

const emit = defineEmits<{
  close: []
}>();

const toolbarStore = useToolbarStore();
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0 });

const startDrag = (event: MouseEvent) => {
  const target = event.target as HTMLElement;

  // Don't start drag if clicking on interactive elements
  const isInteractive =
    target.tagName === 'BUTTON' ||
    target.tagName === 'INPUT' ||
    target.closest('button') ||
    target.closest('input');

  if (isInteractive) {
    return;
  }

  // Allow drag for clicks within the toolbar header (including gaps)
  const toolbarHeader = event.currentTarget as HTMLElement;
  if (toolbarHeader.classList.contains('toolbar-header')) {
    isDragging.value = true;
    dragStart.value = {
      x: event.clientX - toolbarStore.position.x,
      y: event.clientY - toolbarStore.position.y
    };
    event.preventDefault();
  }
};

const onDrag = (event: MouseEvent) => {
  if (isDragging.value) {
    toolbarStore.setPosition({
      x: event.clientX - dragStart.value.x,
      y: event.clientY - dragStart.value.y
    });
  }
};

const stopDrag = () => {
  isDragging.value = false;
};

const closeToolbar = () => {
  // Notify content script to close
  window.postMessage({
    type: WindowMessageType.WEBVERSE_TOOLBAR,
    payload: { type: ToolbarMessageType.TOOLBAR_CLOSE }
  }, '*');

  emit('close');
};

onMounted(() => {
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
});

onUnmounted(() => {
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
});
</script>

<style scoped>
/* Main toolbar container with high specificity and CSS isolation */
.toolbar {
  /* Positioning and sizing */
  position: fixed;
  top: 100px;
  left: 100px;
  z-index: 2147483647; /* Maximum z-index */

  /* Layout */
  display: block;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 12px;
  box-sizing: border-box;
  max-width: none;
  max-height: none;
  min-width: 0;
  min-height: 0;

  /* Visual */
  background: white;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);

  /* Typography reset */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  font-weight: normal;
  font-style: normal;
  font-variant: normal;
  font-stretch: normal;
  line-height: 1.4;
  color: #333;
  text-align: left;
  text-decoration: none;
  text-indent: 0;
  text-shadow: none;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  white-space: normal;

  /* Interaction */
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;

  /* Other resets */
  opacity: 1;
  visibility: visible;
  overflow: visible;
  transform: none;
  filter: none;
  clip: auto;
  clip-path: none;
  isolation: isolate;
  mix-blend-mode: normal;
}

.toolbar-header {
  display: flex;
  align-items: center;
  padding: 4px;
  gap: 4px;
  cursor: move;
  box-sizing: border-box;
  margin: 0;
}

.width-color-section {
  display: flex;
  align-items: center;
  gap: 6px;
  border-right: 1px solid #e0e0e0;
  padding-right: 12px;
  margin-right: 4px;
  cursor: inherit;
  box-sizing: border-box;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  max-width: 24px;
  max-height: 24px;
  background: #f44336;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  margin-left: 3px;
  font-size: 12px;
  font-weight: bold;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  padding: 0;
  box-sizing: border-box;
  flex-shrink: 0;
}

.close-btn:hover {
  background: #d32f2f;
  transform: scale(1.05);
}

.close-btn svg {
  width: 12px;
  height: 12px;
  min-width: 12px;
  min-height: 12px;
  display: block;
}
</style>