import { EncryptionMessageType } from '../../shared/messageTypes';

/**
 * Lock the user by clearing encryption keys from session storage,
 * notifying all tabs about the encryption status change,
 * and switching all tabs from private to public layer.
 *
 * @param reason - The reason for locking (e.g., "KeyVersion increased", "Keys deleted")
 */
export async function lockUser(reason: string): Promise<void> {
  console.log(`🔒 ${reason} - locking user`);

  // Clear DEK1/DEK2 from session storage to lock the user
  await chrome.storage.session.remove(['DEK1', 'DEK2']);

  // Update the cached encryption status
  const { setEncryptionUnlocked } = await import('./messages');
  setEncryptionUnlocked(false);

  // Notify all tabs about encryption status change
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: EncryptionMessageType.ENCRYPTION_STATUS_UPDATE,
          isUnlocked: false
        }).catch(() => {
          // Tab might not have content script loaded, ignore
        });
      }
    }
  } catch (error) {
    console.log('Failed to notify tabs about encryption status change:', error);
  }

  // Switch all private layer tabs to public layer
  try {
    const { switchAllPrivateToPublic } = await import('../layers/management');
    await switchAllPrivateToPublic();
  } catch (error) {
    console.log('Failed to switch tabs to public layer:', error);
  }
}
