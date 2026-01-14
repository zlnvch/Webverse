import { Layer, Tool } from '../../shared/types';

// Tab tracking
export interface TrackedTab {
  tabId: number;
  pageKey: string; // The canonical URL (for public) or HMAC (for private)
  canonicalUrl: string; // Always the original canonical URL
  layer: Layer; // Layer enum (0 = public, 1 = private)
  layerId: string; // Empty string for public, keyVersion for private
  hasLaunchedForCurrentUrl?: boolean; // True if tab has launched for current URL (prevents duplicate relaunch)
  isToolbarActive?: boolean; // True if Webverse toolbar is currently active/visible on this tab
  toolbarState?: {
    layer: Layer; // Layer enum (0 = public, 1 = private)
    showMineOnly: boolean;
    tool: Tool | null;
    color: string;
    width: number;
    position?: { x: number; y: number };
  };
}
