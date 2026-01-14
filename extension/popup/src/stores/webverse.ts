import { defineStore } from 'pinia';
import { isValidPage } from '@shared/utils';
import { StateSyncMessageType, TabLifecycleMessageType } from '@shared/messageTypes';

export const useWebverseStore = defineStore('webverse', {
  state: () => ({
    isLaunched: false,
    canLaunch: true
  }),

  actions: {
    async checkCanLaunch() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
          this.canLaunch = false;
          return;
        }

        const urlObj = new URL(tab.url);
        this.canLaunch = isValidPage(urlObj);
      } catch {
        this.canLaunch = false;
      }
    },

    async launchWebverse() {
      if (!this.canLaunch) return;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab.id) return;

        // Send launch request to background, which will inject the content script
        await chrome.runtime.sendMessage({
          type: StateSyncMessageType.LAUNCH_WEBVERSE,
          tabId: tab.id
        });

        this.isLaunched = true;

        // Close popup after successful launch
        window.close();
      } catch (error) {
        console.log('Failed to launch Webverse:', error);
      }
    },

    async checkWebverseStatus() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.id) {
          const response = await chrome.tabs.sendMessage(tab.id, {
            type: TabLifecycleMessageType.WEBVERSE_STATUS
          });
          this.isLaunched = response?.isLaunched || false;
        }
      } catch {
        this.isLaunched = false;
      }
    },

    setLaunched(status: boolean) {
      this.isLaunched = status;
    }
  }
});

// Listen for toolbar close message
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === TabLifecycleMessageType.TOOLBAR_CLOSED) {
    const webverseStore = useWebverseStore();
    webverseStore.setLaunched(false);
  }
  // Don't return true since we're not sending an async response
});