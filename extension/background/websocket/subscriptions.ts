/**
 * Track active WebSocket subscriptions in session storage
 * This survives background service worker restarts
 */

const STORAGE_KEY = 'activeSubscriptions';

/**
 * Generate a unique subscription key
 */
function getSubscriptionKey(pageKey: string, layer: number, layerId: string): string {
  return `${pageKey}_${layer}_${layerId}`;
}

/**
 * Get all subscriptions from session storage
 */
async function getSubscriptions(): Promise<Set<string>> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as string[] | undefined;
  return new Set(stored || []);
}

/**
 * Save subscriptions to session storage
 */
async function saveSubscriptions(subscriptions: Set<string>): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: Array.from(subscriptions) });
}

/**
 * Check if we're already subscribed to a pageKey/layer/layerId combination
 */
export async function isSubscribed(pageKey: string, layer: number, layerId: string): Promise<boolean> {
  const subscriptions = await getSubscriptions();
  const key = getSubscriptionKey(pageKey, layer, layerId);
  return subscriptions.has(key);
}

/**
 * Mark a pageKey/layer/layerId as subscribed
 */
export async function addSubscription(pageKey: string, layer: number, layerId: string): Promise<void> {
  const subscriptions = await getSubscriptions();
  const key = getSubscriptionKey(pageKey, layer, layerId);
  subscriptions.add(key);
  await saveSubscriptions(subscriptions);
  console.log(`➕ Added subscription: ${key} (total: ${subscriptions.size})`);
}

/**
 * Remove a subscription (when unsubscribing or navigating away)
 */
export async function removeSubscription(pageKey: string, layer: number, layerId: string): Promise<void> {
  const subscriptions = await getSubscriptions();
  const key = getSubscriptionKey(pageKey, layer, layerId);
  subscriptions.delete(key);
  await saveSubscriptions(subscriptions);
  console.log(`➖ Removed subscription: ${key} (total: ${subscriptions.size})`);
}

/**
 * Clear all subscriptions (called on WebSocket disconnect)
 */
export async function clearAllSubscriptions(): Promise<void> {
  const subscriptions = await getSubscriptions();
  const count = subscriptions.size;
  await chrome.storage.session.remove(STORAGE_KEY);
  console.log(`🗑️ Cleared all subscriptions (${count} removed)`);
}

/**
 * Get count of active subscriptions (for debugging)
 */
export async function getSubscriptionCount(): Promise<number> {
  const subscriptions = await getSubscriptions();
  return subscriptions.size;
}

/**
 * Get all subscription keys (for debugging/management)
 */
export async function getAllSubscriptions(): Promise<Array<{pageKey: string, layer: number, layerId: string}>> {
  const subscriptions = await getSubscriptions();
  return Array.from(subscriptions).map(key => {
    const [pageKey, layer, layerId] = key.split('_');
    return { pageKey, layer: parseInt(layer, 10), layerId };
  });
}

/**
 * Parse subscription key into components
 */
export function parseSubscriptionKey(key: string): {pageKey: string, layer: number, layerId: string} {
  const parts = key.split('_');
  // pageKey might contain underscores, so we need to be careful
  // Format is: pageKey_layer_layerId
  // layerId is at the end, layer is before that
  const layerId = parts.pop() || '';
  const layer = parseInt(parts.pop() || '0', 10);
  const pageKey = parts.join('_');
  return { pageKey, layer, layerId };
}
