<template>
  <div class="tool-selector">
    <button
      v-for="tool in tools"
      :key="tool.value"
      :class="['tool-btn', { active: toolbarStore.currentTool === tool.value }]"
      @click="toolbarStore.setTool(toolbarStore.currentTool === tool.value ? null : tool.value)"
      :title="tool.tooltip"
    >
      <span class="tool-icon">{{ tool.icon }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useToolbarStore } from '../stores/toolbar';
import { Tool } from '@shared/types';

const toolbarStore = useToolbarStore();

const tools = [
  {
    value: Tool.Pen,
    tooltip: 'Pen tool',
    icon: '✏️'
  },
  {
    value: Tool.Eraser,
    tooltip: 'Eraser tool',
    icon: '🧹'
  }
];
</script>

<script lang="ts">
const PenIcon = {
  template: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
    <path d="M2 2l7.586 7.586"></path>
    <circle cx="11" cy="11" r="2"></circle>
  </svg>`
};

const EraserIcon = {
  template: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M20 20H7l-4-4a1 1 0 0 1 0-1.414l9-9a1 1 0 0 1 1.414 0l7 7a1 1 0 0 1 0 1.414l-4 4z"></path>
    <line x1="13.5" y1="6.5" x2="17.5" y2="10.5"></line>
  </svg>`
};

export default {
  components: { PenIcon, EraserIcon }
};
</script>

<style scoped>
.tool-selector {
  display: flex;
  gap: 4px;
  margin-right: 12px;
  border-right: 1px solid #e0e0e0;
  padding-right: 12px;
  cursor: inherit;
  box-sizing: border-box;
}

.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  max-width: 40px;
  max-height: 40px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  color: #333;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 18px;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  flex-shrink: 0;
}

.tool-btn:hover {
  background: #f5f5f5;
}

.tool-btn.active {
  background: #e3f2fd;
  color: #1976d2;
}

.tool-btn.active::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  background: #1976d2;
  border-radius: 50%;
}

.tool-icon {
  font-size: 18px;
  display: block;
  line-height: 1;
}
</style>