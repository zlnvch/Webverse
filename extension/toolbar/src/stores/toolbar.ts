import { defineStore } from 'pinia';
import { DrawingState, Layer, Stroke, Tool } from '@shared/types';
import { INITIAL_COLOR, INITIAL_WIDTH, INITIAL_POSITION } from '../constants';
import {
  WindowMessageType,
  DrawingMessageType,
  UtilityMessageType,
  StateSyncMessageType
} from '@shared/messageTypes';

interface ToolbarPosition {
  x: number;
  y: number;
}

export const useToolbarStore = defineStore('toolbar', {
  state: (): DrawingState & { isDragging: boolean; myStrokes: Stroke[]; undoStack: Stroke[]; redoStack: Stroke[]; position: ToolbarPosition; justInitialized: boolean } => ({
    currentTool: null,
    currentColor: INITIAL_COLOR,
    currentWidth: INITIAL_WIDTH,
    currentLayer: Layer.Public,
    showMineOnly: false,
    isDrawing: false,
    strokes: [],
    myStrokes: [],
    undoStack: [],
    redoStack: [],
    isDragging: false,
    position: { ...INITIAL_POSITION },
    justInitialized: false
  }),

  getters: {
    currentStrokes(): Stroke[] {
      // Filter strokes based on showMineOnly flag
      if (this.showMineOnly) {
        return this.myStrokes;
      }
      return this.strokes;
    }
  },

  actions: {
    setTool(tool: Tool | null) {
      this.currentTool = tool;

      // Send message to content script to update DrawingEngine
      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR,
        payload: {
          type: DrawingMessageType.SET_TOOL,
          tool
        }
      }, '*');

      this.saveToolbarState();
    },

    setColor(color: string) {
      this.currentColor = color;

      // Send message to content script to update DrawingEngine
      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR,
        payload: {
          type: DrawingMessageType.SET_COLOR,
          color
        }
      }, '*');

      this.saveToolbarState();
    },

    setWidth(width: number) {
      this.currentWidth = width;

      // Send message to content script to update DrawingEngine
      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR,
        payload: {
          type: DrawingMessageType.SET_WIDTH,
          width
        }
      }, '*');

      this.saveToolbarState();
    },

    setLayer(layer: Layer) {
      // console.log('🔄 setLayer called:', layer);
      this.currentLayer = layer;
      // Layer changes are handled through background script message (SWITCH_LAYER)
      // console.log('🔄 Calling saveToolbarState...');
      this.saveToolbarState();
    },

    setShowMineOnly(show: boolean) {
      this.showMineOnly = show;

      // Send message to content script to update DrawingEngine
      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR,
        payload: {
          type: DrawingMessageType.SET_SHOW_MINE_ONLY,
          show
        }
      }, '*');

      this.saveToolbarState();
    },

    // Save toolbar state to background for persistence across refreshes
    saveToolbarState() {
      const state = {
        layer: this.currentLayer,
        showMineOnly: this.showMineOnly,
        tool: this.currentTool,
        color: this.currentColor,
        width: this.currentWidth,
        position: { ...this.position }  // Create plain object clone
      };

      // Send to background script (will save to chrome.storage.session and trackingTabs)
      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR_TO_BACKGROUND,
        messageId: `save_toolbar_state_${Date.now()}_${Math.random()}`,
        message: {
          type: UtilityMessageType.SAVE_TOOLBAR_STATE,
          state
        }
      }, '*');
    },

    // Restore toolbar state from persisted values
    restoreToolbarState(state: any) {
      // Directly set state properties
      if (state.tool !== undefined) {
        this.currentTool = state.tool;
      }
      if (state.color !== undefined) {
        this.currentColor = state.color;
      }
      if (state.width !== undefined) {
        this.currentWidth = state.width;
      }
      if (state.layer !== undefined) {
        this.currentLayer = state.layer;
      }
      if (state.showMineOnly !== undefined) {
        this.showMineOnly = state.showMineOnly;
      }
      if (state.position !== undefined) {
        this.position = state.position;
      }
      // console.log('✅ Restored toolbar state:', state);

      // Sync restored state with content script's DrawingEngine
      // This is needed because after page refresh/navigate, the DrawingEngine
      // is re-injected and doesn't know the current tool/color/width settings
      if (state.tool !== undefined) {
        window.postMessage({
          type: WindowMessageType.WEBVERSE_TOOLBAR,
          payload: {
            type: DrawingMessageType.SET_TOOL,
            tool: state.tool
          }
        }, '*');
      }
      if (state.color !== undefined) {
        window.postMessage({
          type: WindowMessageType.WEBVERSE_TOOLBAR,
          payload: {
            type: DrawingMessageType.SET_COLOR,
            color: state.color
          }
        }, '*');
      }
      if (state.width !== undefined) {
        window.postMessage({
          type: WindowMessageType.WEBVERSE_TOOLBAR,
          payload: {
            type: DrawingMessageType.SET_WIDTH,
            width: state.width
          }
        }, '*');
      }
      if (state.showMineOnly !== undefined) {
        window.postMessage({
          type: WindowMessageType.WEBVERSE_TOOLBAR,
          payload: {
            type: DrawingMessageType.SET_SHOW_MINE_ONLY,
            show: state.showMineOnly
          }
        }, '*');
      }
    },

    setPosition(position: ToolbarPosition) {
      this.position = position;
      this.saveToolbarState();
    },

    undo() {
      // Send message to content script
      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR,
        payload: {
          type: DrawingMessageType.UNDO
        }
      }, '*');
    },

    redo() {
      // Send message to content script
      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR,
        payload: {
          type: DrawingMessageType.REDO
        }
      }, '*');
    },

    syncStrokes(strokes: Stroke[], myStrokes: Stroke[]) {
      this.strokes = strokes;
      this.myStrokes = myStrokes;
    },

    updateUndoRedoStacks(undoStack: Stroke[], redoStack: Stroke[]) {
      this.undoStack = undoStack;
      this.redoStack = redoStack;
    }
  }
});

// Listen for stroke updates from content script
window.addEventListener('message', (event) => {
  if (event.data.type === WindowMessageType.WEBVERSE_CONTENT_SCRIPT) {
    const { type, strokes, myStrokes, undoStack, redoStack } = event.data.payload;

    if (type === StateSyncMessageType.STROKES_SYNC) {
      const store = useToolbarStore();
      store.syncStrokes(strokes || [], myStrokes || []);
      if (undoStack !== undefined && redoStack !== undefined) {
        store.updateUndoRedoStacks(undoStack, redoStack);
      }
    } else if (type === StateSyncMessageType.RESTORE_TOOLBAR_STATE) {
      const store = useToolbarStore();
      store.restoreToolbarState(event.data.payload.state);
    }
  }
});