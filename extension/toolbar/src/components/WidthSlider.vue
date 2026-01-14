<template>
  <div class="width-slider">
    <input
      type="range"
      min="1"
      :max="MAX_WIDTH"
      :value="toolbarStore.currentWidth"
      @input="updateWidth"
      class="slider"
    />
    <span class="width-text">{{ toolbarStore.currentWidth }}px</span>
  </div>
</template>

<script setup lang="ts">
import { useToolbarStore } from '../stores/toolbar';
import { MAX_WIDTH } from '../constants';

const toolbarStore = useToolbarStore();

const updateWidth = (event: Event) => {
  const target = event.target as HTMLInputElement;
  toolbarStore.setWidth(parseInt(target.value));
};
</script>

<style scoped>
/* Increased specificity to prevent conflicts */
.width-slider {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: inherit;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.label {
  font-size: 12px;
  color: #666;
  min-width: 30px;
}

.slider {
  width: 80px;
  height: 4px;
  background: #ddd;
  outline: none;
  border-radius: 2px;
  -webkit-appearance: none;
  appearance: none;
  border: none;
  padding: 0;
  margin: 0;
}

/* Webkit browsers */
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #1976d2;
  cursor: pointer;
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  margin: -6px 0; /* Center the thumb */
}

/* Firefox */
.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #1976d2;
  cursor: pointer;
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  border: none;
}

.width-text {
  font-size: 11px;
  color: #666;
  min-width: 35px;
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1;
}
</style>