// Handles forwarding messages to WebSocket via background script
import { WebSocketMessageType } from '@shared/messageTypes';

export async function forwardToWebSocket(message: any): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: WebSocketMessageType.WEBSOCKET_FORWARD,
      message
    });
    return response?.success || false;
  } catch (error) {
    // console.error('❌ Failed to forward WebSocket message:', error);
    return false;
  }
}

export function sendLoadAndSubscribe(
  pageKey: string,
  layer: number,
  layerId: string,
  forwardFn: (message: any) => Promise<boolean>
) {
  // Send load message
  forwardFn({
    type: 'load',
    data: {
      pageKey,
      layer,
      layerId
    }
  });

  // Send subscribe message
  forwardFn({
    type: 'subscribe',
    data: {
      pageKey,
      layer,
      layerId
    }
  });
}
