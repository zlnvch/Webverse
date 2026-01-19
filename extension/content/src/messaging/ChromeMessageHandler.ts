import { Layer, ToolbarState } from '@shared/types';
import { DrawingEngine } from '../DrawingEngine';
import { forwardToWebSocket, sendLoadAndSubscribe } from './WebSocketForwarder';
import {
  UtilityMessageType,
  TabLifecycleMessageType,
  WebSocketMessageType,
  StateSyncMessageType,
  UserMessageType,
  WindowMessageType,
  LayerMessageType,
  EncryptionMessageType,
  ToolbarMessageType
} from '@shared/messageTypes';

export class ChromeMessageHandler {
  private drawingEngine: DrawingEngine;

  constructor(
    drawingEngine: DrawingEngine,
    private onToolbarStateRestore: (state: ToolbarState | null) => void,
    private onTrackedTabInfo: (info: { pageKey?: string; layer?: Layer; layerId?: string } | null) => void,
    private onRelaunch: () => void,
    private onInjectToolbar: () => void,
    private onDestroy: () => void,
    private onCheckAutoLaunch?: () => void,
    private onWebSocketConnected?: () => void,
    private getDrawingEngine?: () => DrawingEngine
  ) {
    this.drawingEngine = drawingEngine;
  }

  handleMessage(message: any, sendResponse: (response?: any) => void): boolean {
    switch (message.type) {
      case UtilityMessageType.PING:
        sendResponse({ pong: true });
        return true;

      case TabLifecycleMessageType.YOUR_TAB_ID:
        this.handleYourTabId(message, sendResponse);
        return true;

      case TabLifecycleMessageType.RELAUNCH_WEBVERSE_ON_NAVIGATION:
        this.handleRelaunchOnNavigation(message, sendResponse);
        return true;

      case TabLifecycleMessageType.WEBVERSE_STATUS:
        sendResponse({ isLaunched: this.isLaunched() });
        return true;

      case TabLifecycleMessageType.CLOSE_WEBVERSE_ON_LOGOUT:
        this.handleCloseOnLogout(sendResponse);
        return true;

      case WebSocketMessageType.WEBSOCKET_MESSAGE:
        this.handleWebSocketMessage(message);
        return true;

      case WebSocketMessageType.WEBSOCKET_CONNECTED:
        this.handleWebSocketConnected();
        return true;

      case WebSocketMessageType.WEBSOCKET_DISCONNECTED:
        this.handleWebSocketDisconnected();
        return true;

      case StateSyncMessageType.RESTORE_TOOLBAR_STATE:
        this.handleRestoreToolbarState(message, sendResponse);
        return true;

      case UserMessageType.LOGOUT_USER:
        this.handleLogoutUser();
        return true;

      case LayerMessageType.SWITCH_LAYER:
        this.handleSwitchLayer(message, sendResponse);
        return true;

      case EncryptionMessageType.ENCRYPTION_STATUS_UPDATE:
        this.handleEncryptionStatusUpdate(message, sendResponse);
        return true;

      default:
        return false;
    }
  }

  private handleYourTabId(message: any, sendResponse: (response?: any) => void) {
    const { toolbarState, pageKey, layer, layerId } = message;

    // Store toolbar state to use when toolbar is ready
    if (toolbarState) {
      this.onToolbarStateRestore(toolbarState);
    }

    // Store tracked tab info (pageKey, layer, layerId) - important for Private layer
    if (pageKey || layer !== undefined) {
      const info = { pageKey, layer, layerId };
      this.onTrackedTabInfo(info);
    }

    // Trigger auto-launch check
    this.onCheckAutoLaunch?.();

    sendResponse({ success: true });
  }

  private handleRelaunchOnNavigation(message: any, sendResponse: (response?: any) => void) {
    const { toolbarState, pageKey, layer, layerId } = message;

    // Store toolbar state to use when toolbar is ready
    if (toolbarState) {
      this.onToolbarStateRestore(toolbarState);
    }

    // Store tracked tab info (pageKey, layer, layerId) - important for Private layer
    if (pageKey || layer !== undefined) {
      const info = { pageKey, layer, layerId };
      this.onTrackedTabInfo(info);
    }

    // Trigger relaunch
    this.onRelaunch();
    this.onInjectToolbar();

    // Load strokes for the new page
    // Need to import dynamically to avoid circular dependency
    import('./WebSocketForwarder').then(({ sendLoadAndSubscribe, forwardToWebSocket }) => {
      const pageToLoad = pageKey || window.location.href;
      const layerToLoad = layer !== undefined ? layer : 0;
      const layerIdToLoad = layerId || '';

      sendLoadAndSubscribe(pageToLoad, layerToLoad, layerIdToLoad, forwardToWebSocket);
    }).catch(() => {
      // Silently suppress errors
    });

    sendResponse({ success: true });
  }

  private handleCloseOnLogout(sendResponse: (response?: any) => void) {
    if (this.drawingEngine) {
      const canvas = this.drawingEngine.getCanvas();
      canvas.remove();
      (this.drawingEngine as any) = null;
    }

    // Also send message to toolbar to close itself
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: { type: ToolbarMessageType.TOOLBAR_CLOSE }
    }, '*');

    sendResponse({ success: true });
  }

  private handleWebSocketMessage(message: any) {
    const wsMessage = message.message;

    if (wsMessage.type === 'load_response' && wsMessage.data) {
      if (this.drawingEngine) {
        const { strokes } = wsMessage.data;
        if (strokes && Array.isArray(strokes)) {
          this.drawingEngine.setStrokes(strokes);
        }
      }
    }

    if (wsMessage.type === 'draw_response' && wsMessage.data) {
      if (this.drawingEngine) {
        const { userStrokeId, strokeId, success } = wsMessage.data;
        if (success === false) {
          console.log(`❌ draw_response failed for userStrokeId ${userStrokeId}, removing stroke`);
          this.drawingEngine.removeUnconfirmedStroke(userStrokeId);
        } else {
          this.drawingEngine.confirmStroke(userStrokeId, strokeId);
        }
      }
    }

    if (wsMessage.type === 'redo_response' && wsMessage.data) {
      if (this.drawingEngine) {
        const { userStrokeId, strokeId, success } = wsMessage.data;
        if (success === false) {
          console.log(`❌ redo_response failed for userStrokeId ${userStrokeId}, removing stroke`);
          this.drawingEngine.removePendingRedoStroke(userStrokeId);
        } else {
          this.drawingEngine.confirmRedo(userStrokeId, strokeId);
        }
      }
    }

    if (wsMessage.type === 'new_stroke' && wsMessage.data) {
      if (this.drawingEngine) {
        const { stroke } = wsMessage.data;
        this.drawingEngine.addStrokeFromServer(stroke);
      }
    }

    if (wsMessage.type === 'delete_stroke' && wsMessage.data) {
      if (this.drawingEngine) {
        const { strokeId, userId } = wsMessage.data;
        this.drawingEngine.deleteStroke(strokeId, userId);
      }
    }

    // Forward WebSocket messages to toolbar
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: { type: ToolbarMessageType.WEBSOCKET_MESSAGE, data: wsMessage }
    }, '*');
  }

  private handleWebSocketConnected() {
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: { type: ToolbarMessageType.WEBSOCKET_CONNECTED }
    }, '*');

    // Notify toolbarMessageHandler to send pending load if needed
    this.onWebSocketConnected?.();
  }

  private handleWebSocketDisconnected() {
    // console.log('🔌 WebSocket disconnected');
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: { type: ToolbarMessageType.WEBSOCKET_DISCONNECTED }
    }, '*');
  }

  private handleRestoreToolbarState(message: any, sendResponse: (response?: any) => void) {
    if (message.state) {
      // Also update drawingEngine with the new state
      if (this.drawingEngine) {
        if (message.state.layer !== undefined) {
          this.drawingEngine.setCurrentLayer(message.state.layer);
        }
        if (message.state.showMineOnly !== undefined) {
          this.drawingEngine.setShowMineOnly(message.state.showMineOnly);
        }
      }

      window.postMessage({
        type: WindowMessageType.WEBVERSE_CONTENT_SCRIPT,
        payload: {
          type: StateSyncMessageType.RESTORE_TOOLBAR_STATE,
          state: message.state
        }
      }, '*');
    }
    sendResponse({ success: true });
  }

  private handleLogoutUser() {
    this.onDestroy();

    // Also send message to toolbar to close itself
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: { type: ToolbarMessageType.TOOLBAR_CLOSE }
    }, '*');
  }

  private handleSwitchLayer(message: any, sendResponse: (response?: any) => void) {
    // Use getDrawingEngine callback if available to get fresh reference
    const engine = this.getDrawingEngine ? this.getDrawingEngine() : this.drawingEngine;

    if (engine) {
      const { layer, pageKey, layerId, toolbarState } = message;

      // Canvas is already cleared by START_LAYER_SWITCH, just update state
      engine.setCurrentLayer(layer);
      engine.setCurrentPageKey(pageKey);
      engine.setCurrentLayerId(layerId || '');

      // Apply toolbar state if provided (ensures showMineOnly is updated immediately)
      if (toolbarState) {
        if (toolbarState.showMineOnly !== undefined) {
          engine.setShowMineOnly(toolbarState.showMineOnly);
        }
      }

      // Send load message to get strokes for new layer
      sendLoadAndSubscribe(
        pageKey,
        layer,
        layerId || '',
        forwardToWebSocket
      );

      // Clear the flag immediately after sending load
      engine.endLayerSwitch();
    }

    sendResponse({ success: true });
  }

  private handleEncryptionStatusUpdate(message: any, sendResponse: (response?: any) => void) {
    // Use getDrawingEngine callback if available to get fresh reference
    const engine = this.getDrawingEngine ? this.getDrawingEngine() : this.drawingEngine;

    // Forward encryption status update to toolbar
    window.postMessage({
      type: WindowMessageType.WEBVERSE_ENCRYPTION_STATUS_UPDATE,
      isUnlocked: message.isUnlocked
    }, '*');

    // If encryption was just unlocked and we're on Private layer, reload strokes
    if (engine && message.isUnlocked && engine.getCurrentLayer() === Layer.Private) {
      // console.log('🔓 Private layer unlocked, reloading strokes');

      const currentPageKey = engine.getCurrentPageKey();
      const currentLayerId = engine.getLayerId();

      // console.log('🔓 Reloading with pageKey:', currentPageKey, 'layerId:', currentLayerId);

      // Clear and reload
      engine.clearStrokes();
      engine.clearCanvas();

      // Send load message to get private strokes
      sendLoadAndSubscribe(
        currentPageKey,
        Layer.Private,
        currentLayerId,
        forwardToWebSocket
      );
    }

    sendResponse({ success: true });
  }

  private isLaunched(): boolean {
    return this.drawingEngine !== null;
  }
}
