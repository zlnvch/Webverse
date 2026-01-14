/**
 * Centralized message types for Webverse extension
 *
 * All message types are defined here to:
 * - Prevent typos through compile-time checking
 * - Provide a single source of truth for all messages
 * - Enable better IDE autocomplete and refactoring
 * - Document message contracts with TypeScript types
 */

import { ToolbarState } from './types';

// ============================================================================
// TAB LIFECYCLE MESSAGES
// ============================================================================

export enum TabLifecycleMessageType {
  /** Request tab ID from background */
  GET_TAB_ID = 'GET_TAB_ID',

  /** Request tab ID for toolbar initialization */
  GET_TAB_ID_FOR_TOOLBAR = 'GET_TAB_ID_FOR_TOOLBAR',

  /** Content script notifies that it's ready */
  CONTENT_SCRIPT_READY = 'CONTENT_SCRIPT_READY',

  /** Background acknowledges tab ID and sends tracking info */
  YOUR_TAB_ID = 'YOUR_TAB_ID',

  /** Background triggers relaunch after page navigation */
  RELAUNCH_WEBVERSE_ON_NAVIGATION = 'RELAUNCH_WEBVERSE_ON_NAVIGATION',

  /** Get encryption key version for current tab */
  GET_TAB_KEY_VERSION = 'GET_TAB_KEY_VERSION',

  /** Toolbar opened on a tab */
  TOOLBAR_OPENED = 'TOOLBAR_OPENED',

  /** Toolbar closed on a tab */
  TOOLBAR_CLOSED = 'TOOLBAR_CLOSED',

  /** Check if Webverse is launched */
  WEBVERSE_STATUS = 'WEBVERSE_STATUS',

  /** Close Webverse when user logs out */
  CLOSE_WEBVERSE_ON_LOGOUT = 'CLOSE_WEBVERSE_ON_LOGOUT',
}

// ============================================================================
// WEBSOCKET MESSAGES
// ============================================================================

export enum WebSocketMessageType {
  /** Request WebSocket connection */
  WEBSOCKET_CONNECT = 'WEBSOCKET_CONNECT',

  /** Forward message through WebSocket to backend */
  WEBSOCKET_FORWARD = 'WEBSOCKET_FORWARD',

  /** WebSocket message received from backend */
  WEBSOCKET_MESSAGE = 'WEBSOCKET_MESSAGE',

  /** WebSocket connection established */
  WEBSOCKET_CONNECTED = 'WEBSOCKET_CONNECTED',

  /** WebSocket connection lost */
  WEBSOCKET_DISCONNECTED = 'WEBSOCKET_DISCONNECTED',
}

// ============================================================================
// ENCRYPTION MESSAGES
// ============================================================================

export enum EncryptionMessageType {
  /** Get current encryption status (is private layer unlocked?) */
  GET_ENCRYPTION_STATUS = 'GET_ENCRYPTION_STATUS',

  /** Lock the private layer */
  LOCK_ENCRYPTION = 'LOCK_ENCRYPTION',

  /** Unlock the private layer with password */
  UNLOCK_ENCRYPTION = 'UNLOCK_ENCRYPTION',

  /** Setup new encryption keys (enable private layer) */
  SETUP_ENCRYPTION = 'SETUP_ENCRYPTION',

  /** Change private layer password */
  CHANGE_PASSWORD = 'CHANGE_PASSWORD',

  /** Disable (delete) private layer */
  DISABLE_PRIVATE_LAYER = 'DISABLE_PRIVATE_LAYER',

  /** Encryption status changed notification */
  ENCRYPTION_STATUS_UPDATE = 'ENCRYPTION_STATUS_UPDATE',

  /** Internal: Encrypt a stroke for private layer */
  ENCRYPT_STROKE = 'ENCRYPT_STROKE',

  /** Internal: Decrypt a stroke from private layer */
  DECRYPT_STROKE = 'DECRYPT_STROKE',

  /** Internal: Generate page-specific key for private layer */
  GENERATE_PRIVATE_PAGE_KEY = 'GENERATE_PRIVATE_PAGE_KEY',
}

// ============================================================================
// USER / AUTH MESSAGES
// ============================================================================

export enum UserMessageType {
  /** User logout */
  USER_LOGOUT = 'USER_LOGOUT',

  /** Delete user account */
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',

  /** Refresh user data from server */
  REFRESH_USER_DATA = 'REFRESH_USER_DATA',

  /** Initiate OAuth flow (provider specified in payload) */
  OAUTH_REQUEST = 'OAUTH_REQUEST',

  /** Force logout (e.g., token expired) */
  LOGOUT_USER = 'LOGOUT_USER',
}

// ============================================================================
// LAYER MESSAGES
// ============================================================================

export enum LayerMessageType {
  /** Switch between Public/Private layers */
  SWITCH_LAYER = 'SWITCH_LAYER',

  /** Start layer switch process (clears canvas) */
  START_LAYER_SWITCH = 'START_LAYER_SWITCH',
}

// ============================================================================
// DRAWING MESSAGES (TOOLBAR → CONTENT)
// ============================================================================

export enum DrawingMessageType {
  /** Set drawing tool (pen/eraser) */
  SET_TOOL = 'SET_TOOL',

  /** Set stroke color */
  SET_COLOR = 'SET_COLOR',

  /** Set stroke width */
  SET_WIDTH = 'SET_WIDTH',

  /** Toggle "My Strokes" filter */
  SET_SHOW_MINE_ONLY = 'SET_SHOW_MINE_ONLY',

  /** Undo last stroke */
  UNDO = 'UNDO',

  /** Redo last stroke */
  REDO = 'REDO',

  /** Draw a stroke */
  DRAW_STROKE = 'DRAW_STROKE',

  /** Undo a stroke */
  UNDO_STROKE = 'UNDO_STROKE',

  /** Redo a stroke */
  REDO_STROKE = 'REDO_STROKE',
}

// ============================================================================
// TOOLBAR LIFECYCLE MESSAGES
// ============================================================================

export enum ToolbarMessageType {
  /** Toolbar → Content: Inject CSS into Shadow DOM */
  INJECT_CSS = 'INJECT_CSS',

  /** Content → Toolbar: CSS has been injected into Shadow DOM */
  CSS_INJECTED = 'CSS_INJECTED',

  /** Toolbar → Content: Toolbar is ready and initialized */
  TOOLBAR_READY = 'TOOLBAR_READY',

  /** Toolbar → Content: Close the toolbar */
  TOOLBAR_CLOSE = 'TOOLBAR_CLOSE',

  /** WebSocket → Toolbar: WebSocket connection established */
  WEBSOCKET_CONNECTED = 'WEBSOCKET_CONNECTED',

  /** WebSocket → Toolbar: WebSocket connection lost */
  WEBSOCKET_DISCONNECTED = 'WEBSOCKET_DISCONNECTED',

  /** WebSocket → Toolbar: WebSocket message received */
  WEBSOCKET_MESSAGE = 'WEBSOCKET_MESSAGE',
}

// ============================================================================
// STATE SYNC MESSAGES
// ============================================================================

export enum StateSyncMessageType {
  /** Restore toolbar UI state */
  RESTORE_TOOLBAR_STATE = 'RESTORE_TOOLBAR_STATE',

  /** Sync strokes to toolbar */
  STROKES_SYNC = 'STROKES_SYNC',

  /** Launch Webverse (inject content script & toolbar) */
  LAUNCH_WEBVERSE = 'LAUNCH_WEBVERSE',
}

// ============================================================================
// INTERNAL CONTENT SCRIPT MESSAGES
// ============================================================================

export enum InternalContentMessageType {
  /** Request a re-render of the canvas */
  RENDER = 'webverse:render',
}

// ============================================================================
// WINDOW POSTMESSAGE TYPES (CONTENT ↔ TOOLBAR)
// ============================================================================

export enum WindowMessageType {
  /** Content script → Toolbar: Various commands */
  WEBVERSE_TOOLBAR = 'WEBVERSE_TOOLBAR',

  /** Content script → Toolbar: Response to proxied background call */
  WEBVERSE_TOOLBAR_RESPONSE = 'WEBVERSE_TOOLBAR_RESPONSE',

  /** Content script → Toolbar: State updates */
  WEBVERSE_CONTENT_SCRIPT = 'WEBVERSE_CONTENT_SCRIPT',

  /** Content script → Toolbar: Encryption status updates */
  WEBVERSE_ENCRYPTION_STATUS_UPDATE = 'WEBVERSE_ENCRYPTION_STATUS_UPDATE',

  /** Content script → Toolbar: Create toolbar instance */
  WEBVERSE_CREATE_TOOLBAR = 'WEBVERSE_CREATE_TOOLBAR',

  /** Toolbar → Content: Toolbar module loaded and ready */
  WEBVERSE_TOOLBAR_MODULE_LOADED = 'WEBVERSE_TOOLBAR_MODULE_LOADED',

  /** Toolbar → Content: Forward message to background (proxied) */
  WEBVERSE_TOOLBAR_TO_BACKGROUND = 'WEBVERSE_TOOLBAR_TO_BACKGROUND',
}

// ============================================================================
// UTILITY MESSAGES
// ============================================================================

export enum UtilityMessageType {
  /** Connection test ping */
  PING = 'PING',

  /** Connection test pong response */
  PONG = 'PONG',

  /** Request UUID for a new stroke */
  GET_NEXT_STROKE_ID = 'GET_NEXT_STROKE_ID',

  /** Save toolbar state to background */
  SAVE_TOOLBAR_STATE = 'SAVE_TOOLBAR_STATE',
}

// ============================================================================
// MESSAGE PAYLOAD TYPES
// ============================================================================

export interface YourTabIdPayload {
  tabId?: number;
  toolbarState?: ToolbarState;
  pageKey?: string;
  layer?: number;
  layerId?: string;
}

export interface SwitchLayerPayload {
  canonicalUrl: string;
  layer: number;
  keyVersion: string;
  toolbarState?: ToolbarState;
}

export interface SwitchLayerResponse {
  layer: number;
  pageKey: string;
  layerId: string;
  toolbarState?: ToolbarState;
}

export interface WebSocketMessage {
  type: string;
  message?: any;
}

export interface EncryptStrokePayload {
  encryptedStroke: string;
  nonce: string;
  pageKey: string;
}

export interface DrawStrokeData {
  pageKey: string;
  stroke: any;
  userStrokeId: string;
  layer: number;
}

// ============================================================================
// MESSAGE TYPE UNIONS
// ============================================================================

export type MessageType =
  | TabLifecycleMessageType
  | WebSocketMessageType
  | EncryptionMessageType
  | UserMessageType
  | LayerMessageType
  | DrawingMessageType
  | ToolbarMessageType
  | StateSyncMessageType
  | InternalContentMessageType
  | WindowMessageType
  | UtilityMessageType;
