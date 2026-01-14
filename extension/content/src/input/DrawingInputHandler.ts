import { Point, Stroke, Tool, Layer } from '@shared/types';
import { StrokeManager } from '../core/StrokeManager';
import { normalizePageUrl } from '../../../shared/utils';
import { UtilityMessageType, WindowMessageType, DrawingMessageType } from '@shared/messageTypes';

const MAX_STROKE_POINTS = 1000;

export class DrawingInputHandler {
  private currentPoints: Point[] = [];
  private isDrawing = false;

  constructor(
    private strokeManager: StrokeManager,
    private canvas: HTMLCanvasElement,
    private onRender: () => void,
    private onClearRedoStack: () => void
  ) {}

  // Convert client coordinates to document coordinates (accounting for scroll)
  private getDocumentPoint(event: MouseEvent): Point {
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    return {
      x: scrollX + event.clientX,
      y: scrollY + event.clientY
    };
  }

  async startDrawing(event: MouseEvent, tool: Tool | null, userId: string | null) {
    if (tool == null || !userId) return;

    this.isDrawing = true;
    this.canvas.style.pointerEvents = 'auto';

    const point = this.getDocumentPoint(event);

    // Start collecting points
    this.currentPoints = [point];
  }

  draw(event: MouseEvent) {
    if (!this.isDrawing || this.currentPoints.length === 0) return;

    const point = this.getDocumentPoint(event);
    this.currentPoints.push(point);

    // Check if we've reached the maximum points for this stroke
    if (this.currentPoints.length >= MAX_STROKE_POINTS) {
      console.log(`🚫 Maximum stroke points reached (${MAX_STROKE_POINTS}), continuing with new stroke`);
      // Finish current stroke and immediately start new one from last point
      this.finishStrokeAndContinue();
    }

    this.onRender();
  }

  stopDrawing(tool: Tool | null) {
    if (!this.isDrawing || this.currentPoints.length === 0) return;

    this.isDrawing = false;
    // Keep pointer events active if a tool is selected
    if (tool) {
      this.canvas.style.pointerEvents = 'auto';
    }

    this.finishStroke(false);
  }

  // Finish current stroke and immediately continue with new one from last point
  private finishStrokeAndContinue() {
    // Keep the last point to continue from
    const lastPoint = this.currentPoints[this.currentPoints.length - 1];

    // Finish the current stroke (pass true to indicate we're continuing)
    this.finishStroke(true, lastPoint);
  }

  // Common logic to finish and send a stroke
  private finishStroke(continuing: boolean = false, continueFrom?: Point) {
    if (this.currentPoints.length === 0) return;

    // Get userStrokeId from background
    chrome.runtime.sendMessage({ type: UtilityMessageType.GET_NEXT_STROKE_ID }, (response) => {
      const userStrokeId = response?.userStrokeId;

      if (!userStrokeId) {
        // console.error('❌ Failed to get userStrokeId');
        this.currentPoints = [];
        return;
      }

      // Clear redo stack when drawing a new stroke (standard undo/redo behavior)
      this.onClearRedoStack();

      // Store in unconfirmed with userStrokeId as key
      const stroke = this.pointsToStroke(userStrokeId);
      this.strokeManager.addUnconfirmedStroke(userStrokeId, stroke);

      // Send stroke to toolbar to forward to WebSocket
      const pageKey = normalizePageUrl(window.location.href);
      window.postMessage({
        type: WindowMessageType.WEBVERSE_TOOLBAR,
        payload: {
          type: DrawingMessageType.DRAW_STROKE,
          data: {
            pageKey: pageKey,
            stroke: stroke,
            userStrokeId: userStrokeId,
            layer: this.currentLayer  // Set by caller
          }
        }
      }, '*');

      // Clear current points or continue from last point
      if (continuing && continueFrom) {
        this.currentPoints = [continueFrom];
      } else {
        this.currentPoints = [];
      }
      this.onRender();
    });
  }

  // Helper: Convert points array to stroke with deltas
  private pointsToStroke(userStrokeId: number): Stroke {
    if (this.currentPoints.length === 0) {
      throw new Error('Cannot create stroke from empty points array');
    }

    const stroke: Stroke = {
      id: `temp_${userStrokeId}`,
      userId: this.currentUserId || '',
      tool: this.currentTool || 0, // 0 = Pen
      color: this.currentColor,
      width: this.currentWidth,
      startX: this.currentPoints[0].x,
      startY: this.currentPoints[0].y,
      dx: [],
      dy: []
    };

    // Calculate deltas from subsequent points
    for (let i = 1; i < this.currentPoints.length; i++) {
      stroke.dx.push(this.currentPoints[i].x - this.currentPoints[i - 1].x);
      stroke.dy.push(this.currentPoints[i].y - this.currentPoints[i - 1].y);
    }

    return stroke;
  }

  getCurrentPoints(): Point[] {
    return this.currentPoints;
  }

  isCurrentlyDrawing(): boolean {
    return this.isDrawing;
  }

  clearCurrentPoints(): void {
    this.currentPoints = [];
  }

  // Current stroke state (set by DrawingEngine before calling drawing methods)
  private currentTool: Tool | null = null;
  private currentColor = '#000000';
  private currentWidth = 4;
  private currentLayer: Layer = Layer.Public;
  private currentUserId: string | null = null;

  // Set current drawing state before stroke
  setCurrentStrokeState(
    tool: Tool | null,
    color: string,
    width: number,
    layer: Layer,
    userId: string | null
  ) {
    this.currentTool = tool;
    this.currentColor = color;
    this.currentWidth = width;
    this.currentLayer = layer;
    this.currentUserId = userId;
  }
}
