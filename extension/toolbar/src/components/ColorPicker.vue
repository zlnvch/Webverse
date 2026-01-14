<template>
  <div class="color-picker">
    <button
      class="color-btn"
      :style="{ backgroundColor: toolbarStore.currentColor }"
      @click="showPresets = !showPresets"
      title="Select color"
    ></button>

    <div v-if="showPresets" class="color-popup" @click.stop>
      <div class="preset-colors">
        <button
          v-for="color in DEFAULT_COLORS"
          :key="color"
          :class="['preset-color', { active: toolbarStore.currentColor === color }]"
          :style="{ backgroundColor: color }"
          @click="selectColor(color)"
        ></button>
      </div>
      <input
        type="color"
        :value="toolbarStore.currentColor"
        @input="selectCustomColor"
        @change="selectCustomColor"
        class="custom-color-input"
        title="Choose custom color"
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useToolbarStore } from '../stores/toolbar';
import { DEFAULT_COLORS } from '../constants';
import { Tool } from '@shared/types';

const toolbarStore = useToolbarStore();
const showPresets = ref(false);

const selectColor = (color: string) => {
  toolbarStore.setColor(color);
  toolbarStore.setTool(Tool.Pen);  // Automatically switch to pen tool
  showPresets.value = false;
};

const selectCustomColor = (event: Event) => {
  const target = event.target as HTMLInputElement;
  toolbarStore.setColor(target.value);
  toolbarStore.setTool(Tool.Pen);  // Automatically switch to pen tool
};

const handleClickOutside = (event: MouseEvent) => {
  // Close popup if clicking outside the color picker component
  const target = event.target as Node;
  const colorPicker = document.querySelector('.color-picker');

  if (showPresets.value && colorPicker && !colorPicker.contains(target)) {
    showPresets.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside, true);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside, true);
});
</script>

<style scoped>
.color-picker {
  position: relative;
  cursor: inherit;
  box-sizing: border-box;
}

.color-btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
  max-width: 32px;
  max-height: 32px;
  border: 2px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  /* Remove background to allow inline style to work */
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  flex-shrink: 0;
  /* Fallback background - inline style will override this */
  background-color: white;
}

.color-btn:hover {
  transform: scale(1.05);
  border-color: #1976d2;
}

.color-popup {
  position: absolute;
  top: 50px;
  left: 0;
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  padding: 4px;
  z-index: 2147483647; /* Maximum z-index */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #333;
  box-sizing: border-box;
}

.preset-colors {
  display: grid;
  grid-template-columns: repeat(5, 28px);
  gap: 6px;
  justify-content: center;
  margin-bottom: 6px;
  box-sizing: border-box;
}

.preset-color {
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  max-width: 28px;
  max-height: 28px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
}

.preset-color:hover {
  transform: scale(1.1);
}

.preset-color.active {
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
}

/* White color visibility fix */
.preset-color[style*="#FFFFFF"],
.preset-color[style*="#ffffff"],
.preset-color[style*="rgb(255, 255, 255)"] {
  border-color: #ccc;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
}

.custom-color-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background: #f5f5f5;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #333;
  transition: background 0.2s;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  box-sizing: border-box;
  margin: 0;
}

.custom-color-input {
  width: 168px;
  height: 32px;
  min-width: 168px;
  min-height: 32px;
  max-width: 168px;
  max-height: 32px;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  background: white;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.custom-color-input:hover {
  border-color: #1976d2;
  transform: scale(1.02);
}

.custom-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.custom-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}
</style>