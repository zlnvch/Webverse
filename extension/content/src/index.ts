import {
  initializeApp,
  launch
} from './lifecycle/Initialization';

// Initialize the application (sets up listeners, auto-launch checks, etc.)
initializeApp();

// Listen for LAUNCH_WEBVERSE message from background
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.type === 'LAUNCH_WEBVERSE') {
    launch().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  return false;
});

// Don't auto-initialize - wait for LAUNCH_WEBVERSE message or auto-launch trigger
