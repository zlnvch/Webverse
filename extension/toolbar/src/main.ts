import { createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import Toolbar from './components/Toolbar.vue';
import { useToolbarStore } from './stores/toolbar';
import { INITIAL_POSITION } from './constants';
import { WindowMessageType, WebSocketMessageType, ToolbarMessageType } from '@shared/messageTypes';
import { TOOLBAR_CONTAINER_ID } from '@shared/domConstants';

// Global variables
let currentApp: any = null;
let toolbarCloseCallback: (() => void) | null = null;

// WebSocket status tracking
let isWebSocketConnected = false;

// Send message to background via content script
async function sendMessageToBackground(message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // Create a unique message ID for this request
    const messageId = `toolbar_msg_${Date.now()}_${Math.random()}`;

    // Set up response listener
    const responseListener = (event: MessageEvent) => {
      if (event.data.type === WindowMessageType.WEBVERSE_TOOLBAR_RESPONSE && event.data.messageId === messageId) {
        window.removeEventListener('message', responseListener);
        clearTimeout(timeout);

        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.response);
        }
      }
    };

    // Set up timeout
    const timeout = setTimeout(() => {
      window.removeEventListener('message', responseListener);
      reject(new Error('Background message timeout'));
    }, 5000);

    // Add response listener
    window.addEventListener('message', responseListener);

    // Send message to content script
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR_TO_BACKGROUND,
      messageId,
      message
    }, '*');
  });
}

// Connect to WebSocket via background script
async function connectWebSocket() {
  if (isWebSocketConnected) {
    return; // Already connected
  }

  try {
    // console.log('🔄 Requesting WebSocket connection from background...');
    await sendMessageToBackground({ type: WebSocketMessageType.WEBSOCKET_CONNECT });
  } catch (error) {
    // console.error('❌ Failed to connect WebSocket via background:', error);
  }
}

// Cleanup function
function cleanup() {
  // Background handles WebSocket cleanup
  // console.log('🔄 Toolbar cleanup complete');
}

// Function to create and show toolbar
function createToolbar(initialState?: any) {
  // Check if toolbar already exists
  const existingContainer = document.getElementById(TOOLBAR_CONTAINER_ID);
  if (existingContainer) {
    // console.log('🔄 Toolbar already exists, skipping creation');
    return;
  }

  // Create a container with Shadow DOM for style isolation
  const container = document.createElement('div');
  container.id = TOOLBAR_CONTAINER_ID;
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 999999;
  `;

  // Create Shadow DOM to isolate toolbar styles from page styles
  const shadowRoot = container.attachShadow({ mode: 'open' });

  document.body.appendChild(container);

  // Create mount point for Vue app inside Shadow DOM
  const mountPoint = document.createElement('div');
  // Use saved position if available, otherwise use initial position
  const position = initialState?.position || INITIAL_POSITION;
  mountPoint.style.cssText = `
    position: absolute;
    top: ${position.y}px;
    left: ${position.x}px;
    pointer-events: auto;
  `;
  shadowRoot.appendChild(mountPoint);

  // Request CSS injection from content script and wait for it before mounting Vue
  window.postMessage({
    type: WindowMessageType.WEBVERSE_TOOLBAR,
    payload: {
      type: ToolbarMessageType.INJECT_CSS,
      containerId: TOOLBAR_CONTAINER_ID
    }
  }, '*');

  // Listen for CSS injection completion
  const cssInjectedListener = (event: MessageEvent) => {
    if (event.data.type === WindowMessageType.WEBVERSE_TOOLBAR &&
        event.data.payload.type === ToolbarMessageType.CSS_INJECTED &&
        event.data.payload.containerId === TOOLBAR_CONTAINER_ID) {

      window.removeEventListener('message', cssInjectedListener);

      // Now mount Vue app after CSS is loaded
      mountVueApp(container, mountPoint, initialState);
    }
  };

  window.addEventListener('message', cssInjectedListener);
}

function mountVueApp(container: HTMLElement, mountPoint: HTMLElement, initialState?: any) {
  try {
    // Create Pinia instance first
    const pinia = createPinia();
    setActivePinia(pinia);

    // Create Vue app
    toolbarCloseCallback = () => {
      // console.log('🔄 Closing toolbar, cleaning up WebSocket...');
      cleanup();

      if (currentApp) {
        currentApp.unmount();
        currentApp = null;
      }
      container.remove();
      toolbarCloseCallback = null;
    };

    currentApp = createApp(Toolbar, {
      onClose: toolbarCloseCallback
    });

    currentApp.use(pinia);
    currentApp.mount(mountPoint);

    // Restore state if provided (BEFORE sending TOOLBAR_READY)
    if (initialState) {
      // console.log('🔄 Restoring toolbar state on creation:', initialState);
      const store = useToolbarStore();
      store.restoreToolbarState(initialState);
    }

    // Connect to WebSocket when toolbar is created
    connectWebSocket();

    // Notify content script that toolbar is ready
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: { type: ToolbarMessageType.TOOLBAR_READY }
    }, '*');
  } catch (error) {
    // console.error('❌ Failed to create toolbar:', error);
    container.remove();
  }
}

// Function to close toolbar globally
function closeToolbar() {
  if (toolbarCloseCallback) {
    toolbarCloseCallback();
  }
}

// Listen for creation messages
window.addEventListener('message', (event) => {
  if (event.data.type === WindowMessageType.WEBVERSE_CREATE_TOOLBAR) {
    const toolbarState = event.data.payload?.toolbarState;
    createToolbar(toolbarState);
  }
});

// Listen for toolbar close messages
window.addEventListener('message', (event) => {
  if (event.data.type === WindowMessageType.WEBVERSE_TOOLBAR && event.data.payload.type === ToolbarMessageType.TOOLBAR_CLOSE) {
    closeToolbar();
  }
});

// Notify content script that toolbar module is loaded and ready
window.postMessage({
  type: WindowMessageType.WEBVERSE_TOOLBAR_MODULE_LOADED,
  payload: { timestamp: Date.now() }
}, '*');