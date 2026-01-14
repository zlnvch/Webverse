export interface Point {
  x: number; // Document pixels from left edge
  y: number; // Document pixels from top edge
}

export enum Tool {
  Pen = 0,
  Eraser = 1
}

export enum Layer {
  Public = 0,
  Private = 1
}

// The actual stroke content (what gets encrypted for private strokes)
export interface StrokeContent {
  tool: Tool;
  color: string;
  width: number; // uint8
  startX: number; // uint32
  startY: number; // uint32
  dx: number[]; // int32 array
  dy: number[]; // int32 array
}

// Stroke as stored/received from backend
export interface BackendStroke {
  id: string; // UUIDv7 from backend
  userId: string;
  nonce: string; // Empty for public, base64 for private
  content: string; // Base64-encoded StrokeContent (or encrypted for private)
}

// Stroke as used in the frontend (after decryption)
export interface Stroke {
  id: string; // UUIDv7 from backend
  userId: string;
  tool: Tool; // 0 = pen, 1 = eraser
  color: string;
  width: number; // 1-20 (uint8)
  startX: number; // Starting X coordinate (uint32)
  startY: number; // Starting Y coordinate (uint32)
  dx: number[]; // Delta X values (int32 array)
  dy: number[]; // Delta Y values (int32 array)
}

export interface UserState {
  isLoggedIn: boolean;
  provider?: 'google' | 'github';
  username?: string;
  id?: string;
  token?: string; // JWT token from backend
  keyVersion?: number;
  saltKEK?: string;
  encryptedDEK1?: string;
  nonceDEK1?: string;
  encryptedDEK2?: string;
  nonceDEK2?: string;
}

export interface DrawingState {
  currentTool: Tool | null;
  currentColor: string;
  currentWidth: number;
  currentLayer: Layer; // Layer.Public or Layer.Private
  showMineOnly: boolean; // If true, filter to show only user's strokes (for "Mine" layer)
  isDrawing: boolean;
  strokes: Stroke[];
  undoStack: Stroke[];
  redoStack: Stroke[];
}

export interface ToolbarState {
  layer: Layer;
  showMineOnly: boolean;
  tool: Tool | null;
  color: string;
  width: number;
  position?: { x: number; y: number };
}