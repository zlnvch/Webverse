/**
 * Centralized storage key constants for Webverse extension
 *
 * All chrome.storage.local and chrome.storage.session keys are defined here to:
 * - Prevent typos through compile-time checking
 * - Provide a single source of truth for all storage keys
 * - Enable better IDE autocomplete and refactoring
 */

// ============================================================================
// LOCAL STORAGE KEYS
// ============================================================================

/**
 * User authentication and state data
 * Stored in: chrome.storage.local
 * Type: UserState (see @shared/types)
 */
export const LOCAL_STORAGE_KEYS = {
  /** Complete user state including auth token, encryption keys, and metadata */
  USER_STATE: 'webverse_user_state',

  /** OAuth login result (temporary, cleared after popup reads it) */
  LOGIN_DATA: 'webverse_login_data',

  /** Result of private layer unlock operation */
  UNLOCK_RESULT: 'webverse_unlock_result',

  /** Result of encryption setup operation */
  SETUP_ENCRYPTION_RESULT: 'webverse_setup_encryption_result',

  /** Result of password change operation */
  CHANGE_PASSWORD_RESULT: 'webverse_change_password_result',

  /** Result of private layer disable operation */
  DISABLE_PRIVATE_LAYER_RESULT: 'webverse_disable_private_layer_result',

  /** Result of account deletion operation */
  DELETE_ACCOUNT_RESULT: 'webverse_delete_account_result',

  /** Auto-launch tracking for tabs */
  AUTO_LAUNCH: 'webverse_auto_launch',
} as const;

// ============================================================================
// SESSION STORAGE KEYS
// ============================================================================

/**
 * Temporary session-only data (cleared when browser closes)
 * Stored in: chrome.storage.session
 */
export const SESSION_STORAGE_KEYS = {
  /** Decrypted Data Encryption Key 1 (for private layer strokes - XChaCha20) - Base64 encoded */
  DEK1: 'DEK1',

  /** Decrypted Data Encryption Key 2 (for private layer page keys - HMAC SHA256) - Base64 encoded */
  DEK2: 'DEK2',

  /** Tracked tabs data (mapping of tab IDs to their state) */
  TRACKED_TABS: 'trackedTabs',
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type LocalStorageKey = typeof LOCAL_STORAGE_KEYS[keyof typeof LOCAL_STORAGE_KEYS];
export type SessionStorageKey = typeof SESSION_STORAGE_KEYS[keyof typeof SESSION_STORAGE_KEYS];
