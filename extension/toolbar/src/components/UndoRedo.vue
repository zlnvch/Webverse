<template>
  <div class="undo-redo">
    <button
      :class="['action-btn', { disabled: toolbarStore.myStrokes.length === 0 }]"
      @click="toolbarStore.undo()"
      :disabled="toolbarStore.myStrokes.length === 0"
      title="Undo"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 7v6h6"></path>
        <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"></path>
      </svg>
    </button>
    <button
      :class="['action-btn', { disabled: toolbarStore.redoStack.length === 0 }]"
      @click="toolbarStore.redo()"
      :disabled="toolbarStore.redoStack.length === 0"
      title="Redo"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 7v6h-6"></path>
        <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"></path>
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useToolbarStore } from '../stores/toolbar';

const toolbarStore = useToolbarStore();
</script>

<style scoped>
.undo-redo {
  display: flex;
  gap: 4px;
  cursor: inherit;
  box-sizing: border-box;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  min-width: 36px;
  min-height: 36px;
  max-width: 36px;
  max-height: 36px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  color: #666;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  flex-shrink: 0;
}

.action-btn:hover:not(.disabled) {
  background: #f5f5f5;
  color: #333;
}

.action-btn.disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.action-btn svg {
  width: 16px;
  height: 16px;
  min-width: 16px;
  min-height: 16px;
  display: block;
}
</style>