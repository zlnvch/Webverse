import * as websocket from './websocket';
import { setupTabEventListeners } from './tabs/lifecycle';
import { setupMessageHandlers } from './messages';
import { initializeEncryptionCache } from './encryption/messages';

// Keep-alive alarm to prevent service worker from going dormant while toolbars are open
const KEEP_ALIVE_ALARM_NAME = 'keepalive';
const KEEP_ALIVE_INTERVAL_MINUTES = 0.5; // 30 seconds - less than SW dormancy time

// Setup keep-alive alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM_NAME) {
    // Just receiving this alarm event keeps the SW alive
    // No action needed
  }
});

// Start keep-alive alarm
async function startKeepAlive() {
  await chrome.alarms.create(KEEP_ALIVE_ALARM_NAME, {
    periodInMinutes: KEEP_ALIVE_INTERVAL_MINUTES
  });
  console.log('🔄 Keep-alive alarm started');
}

// Stop keep-alive alarm
async function stopKeepAlive() {
  await chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME);
  console.log('⏸️ Keep-alive alarm stopped');
}

// Export for use in lifecycle handlers
export { startKeepAlive, stopKeepAlive };

// Setup tab event listeners
setupTabEventListeners();

// Setup message handlers
setupMessageHandlers();

// Initialize encryption status cache on startup
initializeEncryptionCache();

// Handle service worker termination
self.addEventListener('beforeunload', () => {
  // Clear keep-alive alarm
  chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME).catch(() => {
    // Ignore errors during cleanup
  });

  // Close WebSocket connection
  websocket.disconnectWebSocket();
});
