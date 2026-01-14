import { Stroke, Layer, Tool } from '@shared/types';
import { CanvasManager } from './core/CanvasManager';
import { StrokeManager } from './core/StrokeManager';
import { StrokeRenderer } from './rendering/StrokeRenderer';
import { DrawingInputHandler } from './input/DrawingInputHandler';
import { normalizePageUrl } from '../../shared/utils';
import {
  WindowMessageType,
  StateSyncMessageType,
  UtilityMessageType,
  DrawingMessageType,
  InternalContentMessageType
} from '@shared/messageTypes';

const INITIAL_COLOR = '#000000';
const INITIAL_WIDTH = 4;

export class DrawingEngine {
  private canvasManager: CanvasManager;
  private strokeManager: StrokeManager;
  private strokeRenderer: StrokeRenderer;
  private inputHandler: DrawingInputHandler;

  // Undo/Redo stacks
  private undoStack: Stroke[] = [];
  private redoStack: Stroke[] = [];

  // Drawing state (previously in ToolManager)
  private currentTool: Tool | null = null;
  private currentColor = INITIAL_COLOR;
  private currentWidth = INITIAL_WIDTH;
  private currentLayer: Layer = Layer.Public;
  private currentLayerId: string = '';
  private showMineOnly: boolean = false;
  private currentPageKey: string = '';
  private currentUserId: string | null = null;
  private isSwitchingLayers = false;

  constructor() {
    this.canvasManager = new CanvasManager();

    this.strokeManager = new StrokeManager(
      () => this.render(),
      () => this.notifyToolbar()
    );

    this.strokeRenderer = new StrokeRenderer(
      this.canvasManager.getContext(),
      this.canvasManager.getCanvas()
    );

    this.inputHandler = new DrawingInputHandler(
      this.strokeManager,
      this.canvasManager.getCanvas(),
      () => this.render(),
      () => this.clearRedoStack()
    );

    // Listen for render events (e.g., from canvas resize)
    window.addEventListener(InternalContentMessageType.RENDER, () => this.render());

    this.loadUserId();
  }

  private async loadUserId() {
    try {
      const result = await chrome.storage.local.get('webverse_user_state');
      const userState = result.webverse_user_state as { id: string } | undefined;
      if (userState && userState.id) {
        this.currentUserId = userState.id;
      }
    } catch (error) {
      if (error instanceof Error) {
        // console.error('❌ Failed to load user ID:', error.message);
      } else {
        // console.error('❌ Failed to load user ID:', String(error));
      }
    }
  }

  private render() {
    this.strokeRenderer.render(
      this.strokeManager.getConfirmedStrokes(),
      this.strokeManager.getUnconfirmedStrokes(),
      this.inputHandler.getCurrentPoints(),
      this.showMineOnly,
      this.currentUserId,
      this.currentColor,
      this.currentWidth,
      this.currentTool
    );
  }

  private notifyToolbar() {
    const myStrokes = this.strokeManager.getConfirmedStrokes().filter(
      s => s.userId === this.currentUserId
    );

    window.postMessage({
      type: WindowMessageType.WEBVERSE_CONTENT_SCRIPT,
      payload: {
        type: StateSyncMessageType.STROKES_SYNC,
        strokes: this.strokeManager.getConfirmedStrokes(),
        myStrokes: myStrokes,
        undoStack: this.undoStack,
        redoStack: this.redoStack
      }
    }, '*');
  }

  // Stroke management
  setStrokes(strokes: Stroke[]) {
    this.strokeManager.setStrokes(strokes);
  }

  confirmStroke(userStrokeId: number, strokeId: string) {
    this.strokeManager.confirmStroke(userStrokeId, strokeId);
  }

  removeUnconfirmedStroke(userStrokeId: number) {
    this.strokeManager.removeUnconfirmedStroke(userStrokeId);
  }

  confirmRedo(userStrokeId: number, strokeId: string) {
    this.strokeManager.confirmRedo(userStrokeId, strokeId);
  }

  removePendingRedoStroke(userStrokeId: number) {
    this.strokeManager.removePendingRedoStroke(userStrokeId);
  }

  addStrokeFromServer(stroke: Stroke) {
    this.strokeManager.addStrokeFromServer(stroke);
  }

  deleteStroke(strokeId: string, userId: string) {
    this.strokeManager.deleteStroke(strokeId, userId);
  }

  // Input handling
  async startDrawing(event: MouseEvent) {
    // Update input handler with current state before drawing
    this.inputHandler.setCurrentStrokeState(
      this.currentTool,
      this.currentColor,
      this.currentWidth,
      this.currentLayer,
      this.currentUserId
    );

    await this.inputHandler.startDrawing(event, this.currentTool, this.currentUserId);
  }

  draw(event: MouseEvent) {
    this.inputHandler.draw(event);
  }

  stopDrawing() {
    this.inputHandler.stopDrawing(this.currentTool);
  }

  // Tool management
  setTool(tool: Tool | null) {
    this.currentTool = tool;

    // Update cursor and pointer events
    const canvas = this.canvasManager.getCanvas();
    if (tool === Tool.Pen || tool === Tool.Eraser) {
      canvas.style.pointerEvents = 'auto';
      canvas.style.cursor = tool === Tool.Pen ? 'crosshair' : 'cell';
    } else {
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = 'default';
    }
  }

  setColor(color: string) {
    this.currentColor = color;
  }

  setWidth(width: number) {
    this.currentWidth = width;
  }

  setLayer(layer: Layer) {
    this.currentLayer = layer;
  }

  setShowMineOnly(show: boolean) {
    this.showMineOnly = show;

    // Don't render if we're in the middle of switching layers
    if (!this.isSwitchingLayers) {
      this.render();
    }
  }

  startLayerSwitch() {
    this.isSwitchingLayers = true;
  }

  endLayerSwitch() {
    this.isSwitchingLayers = false;
  }

  setCurrentLayer(layer: Layer) {
    this.currentLayer = layer;
  }

  setCurrentLayerId(layerId: string) {
    this.currentLayerId = layerId;
  }

  setCurrentPageKey(pageKey: string) {
    this.currentPageKey = pageKey;
  }

  getCurrentPageKey(): string {
    return this.currentPageKey;
  }

  // Canvas operations
  clearCanvas() {
    const ctx = this.canvasManager.getContext();
    const canvas = this.canvasManager.getCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  clearStrokes() {
    // console.log('🗑️ Clearing all strokes from canvas');
    this.strokeManager.clear();
    this.undoStack = [];
    this.redoStack = [];
  }

  // Undo/Redo
  undo() {
    if (!this.currentUserId) return;

    const confirmedStrokes = this.strokeManager.getConfirmedStrokes();
    const unconfirmedStrokes = this.strokeManager.getUnconfirmedStrokes();

    // Get the most recent stroke from this user (including unconfirmed)
    const myConfirmedStrokes = confirmedStrokes.filter(s => s.userId === this.currentUserId);
    const myUnconfirmedStrokes = Array.from(unconfirmedStrokes.values()).filter(s => s.userId === this.currentUserId);

    // Check if the most recent stroke is unconfirmed (hasn't received server ID yet)
    if (myUnconfirmedStrokes.length > 0) {
      // Most recent stroke hasn't received a server ID yet - ignore undo click
      // console.log('⚠️ Cannot undo: most recent stroke has not received server ID yet');
      return;
    }

    if (myConfirmedStrokes.length === 0) return;

    const lastStroke = myConfirmedStrokes[myConfirmedStrokes.length - 1];

    // console.log('↩️ Undoing stroke:', lastStroke.id);

    // Send undo message to server
    const pageKey = normalizePageUrl(window.location.href);
    window.postMessage({
      type: WindowMessageType.WEBVERSE_TOOLBAR,
      payload: {
        type: DrawingMessageType.UNDO_STROKE,
        data: {
          pageKey: pageKey,
          strokeId: lastStroke.id
        }
      }
    }, '*');

    // Remove from confirmed strokes
    this.strokeManager.deleteStroke(lastStroke.id, this.currentUserId);

    // Add to redo stack
    this.redoStack.push(lastStroke);

    // Notify toolbar of state change
    this.notifyToolbar();
  }

  redo() {
    if (this.redoStack.length === 0) return;

    // Get the last item from redo stack (LIFO)
    const stroke = this.redoStack[this.redoStack.length - 1];

    // console.log('↪️ Redoing stroke:', stroke.id);

    // Send redo message to server (stroke keeps original server ID)
    const pageKey = normalizePageUrl(window.location.href);
    const currentPageKey = this.currentPageKey;

    // Get a new userStrokeId for tracking this redo operation
    chrome.runtime.sendMessage({ type: UtilityMessageType.GET_NEXT_STROKE_ID }, (response) => {
      const userStrokeId = response?.userStrokeId;

      if (!userStrokeId) {
        // console.error('❌ Failed to get userStrokeId for redo');
        return;
      }

      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR,
        payload: {
          type: DrawingMessageType.REDO_STROKE,
          data: {
            pageKey: pageKey,
            stroke: stroke,  // Original server ID preserved
            userStrokeId: userStrokeId,
            layer: Number(this.currentLayer),  // Ensure it's sent as number, not string
            currentPageKey: currentPageKey
          }
        }
      }, '*');

      // Store in pending redo strokes so we can update the ID when redo_response arrives
      this.strokeManager.addPendingRedoStroke(userStrokeId, stroke);

      // Optimistically add to confirmed strokes (will be confirmed with redo_response)
      // The stroke manager's confirmRedo method will handle proper insertion
      const confirmedStrokes = this.strokeManager.getConfirmedStrokes();
      confirmedStrokes.push(stroke);

      // Remove from redo stack
      this.redoStack.pop();

      // Notify toolbar of state change
      this.notifyToolbar();
    });
  }

  clear() {
    this.strokeManager.clear();
    this.undoStack = [];
    this.redoStack = [];
  }

  clearRedoStack() {
    this.redoStack = [];
  }

  // Getters
  getCanvas() {
    return this.canvasManager.getCanvas();
  }

  getStrokes() {
    return this.strokeManager.getConfirmedStrokes();
  }

  getMyStrokes() {
    return this.strokeManager.getConfirmedStrokes().filter(
      s => s.userId === this.currentUserId
    );
  }

  getCurrentLayer() {
    return this.currentLayer;
  }

  getLayerId(): string {
    return this.currentLayerId;
  }

  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  getCurrentTool(): Tool | null {
    return this.currentTool;
  }

  getCurrentColor(): string {
    return this.currentColor;
  }

  getCurrentWidth(): number {
    return this.currentWidth;
  }

  getShowMineOnly(): boolean {
    return this.showMineOnly;
  }

  isCurrentlySwitchingLayers(): boolean {
    return this.isSwitchingLayers;
  }
}
