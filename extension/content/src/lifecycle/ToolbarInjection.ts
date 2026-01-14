import { ToolbarState } from '@shared/types';
import { WindowMessageType } from '@shared/messageTypes';
import { TOOLBAR_CONTAINER_ID } from '@shared/domConstants';

// Handles toolbar injection into the DOM

// Track if we've already set up the module loaded listener
let moduleLoadedListenerSetup = false;
// Track if we've received MODULE_LOADED (persists across injectToolbar calls)
let moduleLoadedReceived = false;
// Store pending toolbar state to pass on creation
let pendingToolbarState: ToolbarState | null = null;

export function injectToolbar(toolbarState?: ToolbarState | null): void {
  // Remove any existing toolbar
  const existingContainer = document.getElementById(TOOLBAR_CONTAINER_ID);
  if (existingContainer) {
    existingContainer.remove();
  }

  // Check if module already loaded
  const scriptExists = document.querySelector('script[src*="toolbar/index.js"]');

  // Store toolbar state if provided
  if (toolbarState) {
    pendingToolbarState = toolbarState;
  }

  // Set up module loaded listener (only once)
  if (!moduleLoadedListenerSetup) {
    moduleLoadedListenerSetup = true;

    window.addEventListener('message', (event) => {
      if (event.data.type === WindowMessageType.WEBVERSE_TOOLBAR_MODULE_LOADED) {
        moduleLoadedReceived = true;
        // console.log('✅ Toolbar module loaded, sending CREATE_TOOLBAR message');
        window.postMessage({
          type: WindowMessageType.WEBVERSE_CREATE_TOOLBAR,
          payload: {
            timestamp: Date.now(),
            toolbarState: pendingToolbarState
          }
        }, '*');
      }
    });
  }

  if (!scriptExists) {
    // Inject the toolbar script
    const script = document.createElement('script');
    script.type = 'module';
    script.src = chrome.runtime.getURL('toolbar/index.js');
    document.head.appendChild(script);

    // console.log('📦 Injected toolbar script, waiting for MODULE_LOADED signal...');
  } else if (moduleLoadedReceived) {
    // Script already exists AND we've already received MODULE_LOADED
    // Just send CREATE_TOOLBAR directly to re-create the toolbar
    // console.log('🔄 Toolbar module already loaded, sending CREATE_TOOLBAR message');
    window.postMessage({
      type: WindowMessageType.WEBVERSE_CREATE_TOOLBAR,
      payload: {
        timestamp: Date.now(),
        toolbarState: pendingToolbarState
      }
    }, '*');
  } else {
    // Script exists but we haven't received MODULE_LOADED yet
    // This shouldn't happen in normal flow, but handle it gracefully
    // console.log('⏳ Toolbar script exists but MODULE_LOADED not received yet, waiting...');
  }
}

// Set the toolbar state to be used on next injection
export function setPendingToolbarState(state: ToolbarState | null): void {
  pendingToolbarState = state;
}
