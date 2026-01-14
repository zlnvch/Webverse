import { LifecycleManager } from './LifecycleManager';
import { injectToolbar } from './ToolbarInjection';
import { ChromeMessageHandler } from '../messaging/ChromeMessageHandler';
import { ToolbarMessageHandler } from '../messaging/ToolbarMessageHandler';
import {
  WindowMessageType,
  TabLifecycleMessageType,
  ToolbarMessageType
} from '@shared/messageTypes';
import { TOOLBAR_CONTAINER_ID } from '@shared/domConstants';

// Main application state
let lifecycleManager: LifecycleManager;
let chromeMessageHandler: ChromeMessageHandler;
let toolbarMessageHandler: ToolbarMessageHandler;

export function initializeApp(): void {
  lifecycleManager = new LifecycleManager();

  toolbarMessageHandler = new ToolbarMessageHandler(
    null as any, // Will be set when drawingEngine is created
    () => {
      lifecycleManager.destroy();
    }
  );

  chromeMessageHandler = new ChromeMessageHandler(
    null as any, // Will be set when drawingEngine is created
    (state) => { toolbarMessageHandler.setRestoredState(state); },
    (info) => { toolbarMessageHandler.setTrackedTabInfo(info); },
    () => {
      lifecycleManager.relaunch();
    },
    () => {
      // Get toolbar state before injecting
      const state = toolbarMessageHandler.getRestoredState();
      injectToolbar(state);
    },
    () => {
      lifecycleManager.destroy();
    },
    () => {
      checkAutoLaunch();
    },
    () => {
      // Handle WebSocket connected - trigger pending load if needed
      toolbarMessageHandler.handleWebSocketConnected();
    },
    () => {
      // Provide callback to get current drawingEngine from lifecycleManager
      const engine = lifecycleManager.getDrawingEngine();
      if (!engine) {
        throw new Error('DrawingEngine not initialized');
      }
      return engine;
    }
  );

  setupWindowMessageListener();
  setupChromeMessageListener();
  setupAutoLaunch();
}

function setupWindowMessageListener(): void {
  // Listen for messages from toolbar
  window.addEventListener('message', (event) => {
    // Forward toolbar-to-background messages
    if (event.data.type === WindowMessageType.WEBVERSE_TOOLBAR_TO_BACKGROUND) {
      const { messageId, message } = event.data;

      // Forward to background script
      chrome.runtime.sendMessage(message, (response) => {
        // Send response back to toolbar
        window.postMessage({
          type: WindowMessageType.WEBVERSE_TOOLBAR_RESPONSE,
          messageId,
          response,
          error: chrome.runtime.lastError?.message
        }, '*');
      });
      return;
    }

    if (event.data.type === WindowMessageType.WEBVERSE_TOOLBAR) {
      const payload = event.data.payload;
      const type = payload.type;

      // Handle CSS injection for Shadow DOM
      if (type === ToolbarMessageType.INJECT_CSS && payload.containerId === TOOLBAR_CONTAINER_ID) {
        const container = document.getElementById(TOOLBAR_CONTAINER_ID);
        const shadowRoot = container?.shadowRoot;
        if (shadowRoot) {
          const cssUrl = chrome.runtime.getURL('toolbar/toolbar.css');
          fetch(cssUrl)
            .then(response => response.text())
            .then(cssText => {
              const style = document.createElement('style');
              style.textContent = cssText;
              shadowRoot.appendChild(style);

              // Notify toolbar that CSS is ready
              window.postMessage({
                type: WindowMessageType.WEBVERSE_TOOLBAR,
                payload: {
                  type: ToolbarMessageType.CSS_INJECTED,
                  containerId: TOOLBAR_CONTAINER_ID
                }
              }, '*');
            })
            /*.catch(error => {
              console.error('Failed to load toolbar CSS:', error);
            });*/
        }
        return;
      }

      const drawingEngine = lifecycleManager.getDrawingEngine();

      if (!drawingEngine) return;

      // Update the handler's drawingEngine reference
      (toolbarMessageHandler as any).drawingEngine = drawingEngine;

      // Delegate to ToolbarMessageHandler (pass the whole payload as data)
      toolbarMessageHandler.handleMessage(type, payload);
    }
  });
}

function setupChromeMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    // Update the handler's drawingEngine reference
    (chromeMessageHandler as any).drawingEngine = lifecycleManager.getDrawingEngine();

    // All Chrome messages now flow through ChromeMessageHandler
    return chromeMessageHandler.handleMessage(message, sendResponse);
  });
}

function setupAutoLaunch(): void {
  // Auto-launch if there's a flag in storage
  chrome.storage.local.get(['webverse_auto_launch'], (result) => {
    if (result.webverse_auto_launch) {
      launch();
    }
  });

  // Request tab ID from background to check if we should auto-launch
  chrome.runtime.sendMessage({ type: TabLifecycleMessageType.GET_TAB_ID }, () => {
    // Check for errors to suppress runtime.lastError
    if (chrome.runtime.lastError) {
      // Ignore - content script might be torn down
    }
  });
}

export async function launch(): Promise<void> {
  await lifecycleManager.init();
  // Get toolbar state if available (might be null on first launch)
  const state = toolbarMessageHandler.getRestoredState();
  injectToolbar(state);
}

export function destroy(): void {
  lifecycleManager.destroy();
}

export function checkAutoLaunch(): void {
  launch();
}
