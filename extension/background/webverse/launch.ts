import { StateSyncMessageType } from '../../shared/messageTypes';

// Global counter for userStrokeId
let nextUserStrokeId = 1;

// Handle launch Webverse request from popup
export async function handleLaunchWebverse(message: any, sendResponse: (response?: any) => void) {
  const { tabId } = message;
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: StateSyncMessageType.LAUNCH_WEBVERSE }).catch(() => {
      console.log(`❓ Could not send LAUNCH_WEBVERSE to tab ${tabId}`);
    });
  }
  sendResponse({ success: true });
  return true;
}

// Handle request for next stroke ID
export async function handleGetNextStrokeId(message: any, sendResponse: (response?: any) => void) {
  const strokeId = nextUserStrokeId++;
  console.log(`📝 Allocated userStrokeId: ${strokeId}`);
  sendResponse({ userStrokeId: strokeId });
  return true;
}
