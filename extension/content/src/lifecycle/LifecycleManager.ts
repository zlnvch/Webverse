import { DrawingEngine } from '../DrawingEngine';
import { setupEventListeners } from './EventManager';
import { normalizePageUrl } from '@shared/utils';
import { TabLifecycleMessageType } from '@shared/messageTypes';

async function notifyContentScriptReady(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: TabLifecycleMessageType.CONTENT_SCRIPT_READY,
      pageKey: normalizePageUrl(window.location.href)
    });
  } catch (error) {
    if (error instanceof Error) {
      console.log('❓ Could not send CONTENT_SCRIPT_READY to background:', error.message);
    } else {
      console.log('❓ Could not send CONTENT_SCRIPT_READY to background:', String(error));
    }
  }
}

export class LifecycleManager {
  private drawingEngine: DrawingEngine | null = null;
  private isLaunched = false;

  constructor(
    private onLaunched?: () => void,
    private onDestroyed?: () => void
  ) {}

  async init(): Promise<void> {
    // Always notify background that content script is ready (for tab tracking)
    await notifyContentScriptReady();

    // Only create drawingEngine if it doesn't exist
    if (!this.drawingEngine) {
      this.drawingEngine = new DrawingEngine();
      setupEventListeners(this.drawingEngine);
      this.isLaunched = true;

      this.onLaunched?.();
    }
  }

  destroy(): void {
    if (this.drawingEngine) {
      const canvas = this.drawingEngine.getCanvas();
      canvas.remove();
      this.drawingEngine = null;
      this.isLaunched = false;

      // NOTE: TOOLBAR_CLOSED message is already sent by ToolbarMessageHandler.handleToolbarClose()
      // Do NOT send it here to avoid duplicate messages

      this.onDestroyed?.();
    }
  }

  relaunch(): void {
    // Destroy old drawing engine and canvas
    if (this.drawingEngine) {
      const canvas = this.drawingEngine.getCanvas();
      canvas.remove();
    }

    // Create fresh drawing engine and setup
    this.drawingEngine = new DrawingEngine();
    setupEventListeners(this.drawingEngine);
    this.isLaunched = true;

    // Notify background that content script is ready (for tab tracking)
    notifyContentScriptReady();
  }

  getDrawingEngine(): DrawingEngine | null {
    return this.drawingEngine;
  }

  isEngineLaunched(): boolean {
    return this.isLaunched;
  }
}
