import { DrawingEngine } from '../DrawingEngine';
import { forwardToWebSocket, sendLoadAndSubscribe } from './WebSocketForwarder';
import { Layer, ToolbarState } from '@shared/types';
import { normalizePageUrl } from '@shared/utils';
import {
  DrawingMessageType,
  LayerMessageType,
  TabLifecycleMessageType,
  WindowMessageType,
  StateSyncMessageType,
  ToolbarMessageType
} from '@shared/messageTypes';

interface TrackedTabInfo {
  pageKey?: string;
  layerId?: string;
}

export class ToolbarMessageHandler {
  private restoredToolbarState: ToolbarState | null = null;
  private trackedTabInfo: TrackedTabInfo | null = null;
  private pendingLoadAfterConnect = false;

  constructor(
    private drawingEngine: DrawingEngine,
    private onToolbarDestroyed?: () => void
  ) {}

  setRestoredState(state: ToolbarState | null) {
    this.restoredToolbarState = state;
  }

  getRestoredState(): ToolbarState | null {
    return this.restoredToolbarState;
  }

  setTrackedTabInfo(info: TrackedTabInfo | null) {
    this.trackedTabInfo = info;
  }

  handleWebSocketConnected(): void {
    // If we're waiting to send load/subscribe (initial launch), do it now
    if (this.pendingLoadAfterConnect) {
      sendLoadAndSubscribe(
        normalizePageUrl(window.location.href),
        Layer.Public,
        '',
        forwardToWebSocket
      );

      // Clear the flag after sending
      this.pendingLoadAfterConnect = false;
    }
  }

  handleMessage(type: string, data: any): boolean {
    switch (type) {
      case ToolbarMessageType.TOOLBAR_READY:
        return this.handleToolbarReady();

      case DrawingMessageType.SET_TOOL:
        if (data?.tool !== undefined) {
          this.drawingEngine.setTool(data.tool);
        }
        return true;

      case DrawingMessageType.SET_COLOR:
        if (data?.color) {
          this.drawingEngine.setColor(data.color);
        }
        return true;

      case DrawingMessageType.SET_WIDTH:
        if (data?.width !== undefined) {
          this.drawingEngine.setWidth(data.width);
        }
        return true;

      case DrawingMessageType.SET_SHOW_MINE_ONLY:
        if (data?.show !== undefined) {
          this.drawingEngine.setShowMineOnly(data.show);
        }
        return true;

      case DrawingMessageType.UNDO:
        this.drawingEngine.undo();
        return true;

      case DrawingMessageType.REDO:
        this.drawingEngine.redo();
        return true;

      case LayerMessageType.START_LAYER_SWITCH:
        this.drawingEngine.startLayerSwitch();
        this.drawingEngine.clearStrokes();
        this.drawingEngine.clearCanvas();
        return true;

      case ToolbarMessageType.TOOLBAR_CLOSE:
        this.handleToolbarClose();
        return true;

      case DrawingMessageType.DRAW_STROKE:
        if (data?.data?.pageKey && data?.data?.stroke && data?.data?.userStrokeId) {
          forwardToWebSocket({
            type: 'draw',
            data: {
              pageKey: data.data.pageKey,
              stroke: data.data.stroke,
              userStrokeId: data.data.userStrokeId,
              layer: data.data.layer
            }
          });
        }
        return true;

      case DrawingMessageType.UNDO_STROKE:
        if (data?.data?.pageKey && data?.data?.strokeId) {
          forwardToWebSocket({
            type: 'undo',
            data: {
              pageKey: data.data.pageKey,
              strokeId: data.data.strokeId
            }
          });
        }
        return true;

      case DrawingMessageType.REDO_STROKE:
        if (data?.data?.pageKey && data?.data?.stroke && data?.data?.userStrokeId) {
          forwardToWebSocket({
            type: 'redo',
            data: {
              pageKey: data.data.pageKey,
              stroke: data.data.stroke,
              userStrokeId: data.data.userStrokeId,
              layer: data.data.layer
            }
          });
        }
        return true;

      case LayerMessageType.SWITCH_LAYER:
        if (data?.canonicalUrl && data?.layer) {
          chrome.runtime.sendMessage({
            type: LayerMessageType.SWITCH_LAYER,
            canonicalUrl: data.canonicalUrl,
            layer: data.layer,
            keyVersion: data.keyVersion || ''
          }).catch(() => {
            // console.error('Failed to forward SWITCH_LAYER to background');
          });
        }
        return true;

      default:
        return false;
    }
  }

  private handleToolbarReady(): boolean {
    chrome.runtime.sendMessage({ type: TabLifecycleMessageType.TOOLBAR_OPENED }).catch(() => {
      // console.error('❌ Failed to send TOOLBAR_OPENED to background');
    });

    if (this.restoredToolbarState) {
      // Forward toolbar state to toolbar
      window.postMessage({
        type: WindowMessageType.WEBVERSE_CONTENT_SCRIPT,
        payload: {
          type: StateSyncMessageType.RESTORE_TOOLBAR_STATE,
          state: this.restoredToolbarState
        }
      }, '*');

      // Update DrawingEngine state
      this.drawingEngine.setCurrentLayer(this.restoredToolbarState.layer);
      this.drawingEngine.setCurrentLayerId(this.trackedTabInfo?.layerId || '');
      this.drawingEngine.setShowMineOnly(this.restoredToolbarState.showMineOnly);

      // Restore tool, color, and width
      if (this.restoredToolbarState.tool) {
        this.drawingEngine.setTool(this.restoredToolbarState.tool);
      }
      if (this.restoredToolbarState.color) {
        this.drawingEngine.setColor(this.restoredToolbarState.color);
      }
      if (this.restoredToolbarState.width) {
        this.drawingEngine.setWidth(this.restoredToolbarState.width);
      }

      // Use tracked tab info if available (important for Private layer pageKey)
      const layerId = this.restoredToolbarState.layer === Layer.Private ? (this.trackedTabInfo?.layerId || '') : '';
      const pageKey = this.trackedTabInfo?.pageKey || undefined;

      // Load and subscribe with the restored layer and pageKey
      sendLoadAndSubscribe(
        pageKey || normalizePageUrl(window.location.href),
        this.restoredToolbarState.layer,
        layerId,
        forwardToWebSocket
      );

      // Clear restored state after using it
      this.restoredToolbarState = null;
      this.trackedTabInfo = null;
    } else {
      this.pendingLoadAfterConnect = true;
    }

    return true;
  }

  private handleToolbarClose() {
    chrome.runtime.sendMessage({ type: TabLifecycleMessageType.TOOLBAR_CLOSED }).catch(() => {});

    const canvas = this.drawingEngine.getCanvas();
    canvas.remove();

    this.onToolbarDestroyed?.();
  }
}
