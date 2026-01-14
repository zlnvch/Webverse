import { Stroke, Point, Tool } from '@shared/types';

export class StrokeRenderer {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private canvas: HTMLCanvasElement
  ) {}

  // Convert document coordinates to viewport coordinates (accounting for scroll)
  private getViewportPoint(point: Point): Point {
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    return {
      x: point.x - scrollX,
      y: point.y - scrollY
    };
  }

  render(
    confirmedStrokes: Stroke[],
    unconfirmedStrokes: Map<number, Stroke>,
    currentPoints: Point[],
    showMineOnly: boolean,
    currentUserId: string | null,
    currentColor: string,
    currentWidth: number,
    currentTool: Tool | null
  ) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Filter confirmed strokes based on showMineOnly
    const confirmedToRender = showMineOnly
      ? confirmedStrokes.filter(s => s.userId === currentUserId)
      : confirmedStrokes;

    // Render confirmed strokes (filtered)
    for (const stroke of confirmedToRender) {
      this.renderStroke(stroke);
    }

    // Render unconfirmed strokes (always show own strokes being drawn)
    for (const stroke of unconfirmedStrokes.values()) {
      this.renderStroke(stroke);
    }

    // Render current stroke being drawn
    if (currentPoints.length > 0) {
      // If only 1 point, render a dot
      if (currentPoints.length === 1) {
        const point = this.getViewportPoint(currentPoints[0]);
        this.ctx.save();
        this.ctx.fillStyle = currentColor;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, currentWidth / 2, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
      } else {
        // Multiple points - render as stroke
        const currentStroke = this.pointsToStroke(currentPoints, currentUserId || '', currentColor, currentWidth, currentTool);
        this.renderStroke(currentStroke);
      }
    }
  }

  private renderStroke(stroke: Stroke) {
    const points = this.strokeToPoints(stroke);
    if (points.length < 2) return;

    this.ctx.save();
    this.ctx.globalCompositeOperation = stroke.tool === Tool.Eraser ? 'destination-out' : 'source-over';
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = stroke.width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.beginPath();

    const startPoint = this.getViewportPoint(points[0]);
    this.ctx.moveTo(startPoint.x, startPoint.y);

    for (let i = 1; i < points.length; i++) {
      const point = this.getViewportPoint(points[i]);
      this.ctx.lineTo(point.x, point.y);
    }

    this.ctx.stroke();
    this.ctx.restore();
  }

  // Helper: Convert points array to stroke with deltas
  private pointsToStroke(points: Point[], userId: string, color: string, width: number, tool: Tool | null): Stroke {
    if (points.length === 0) {
      throw new Error('Cannot create stroke from empty points array');
    }

    const stroke: Stroke = {
      id: `temp_${Date.now()}`, // Temporary ID
      userId: userId,
      tool: tool ?? Tool.Pen,
      color: color,
      width: width,
      startX: points[0].x,
      startY: points[0].y,
      dx: [],
      dy: []
    };

    // Calculate deltas from subsequent points
    for (let i = 1; i < points.length; i++) {
      stroke.dx.push(points[i].x - points[i - 1].x);
      stroke.dy.push(points[i].y - points[i - 1].y);
    }

    return stroke;
  }

  // Helper: Convert stroke with deltas back to points for rendering
  private strokeToPoints(stroke: Stroke): Point[] {
    const points: Point[] = [
      { x: stroke.startX, y: stroke.startY }
    ];

    let x = stroke.startX;
    let y = stroke.startY;

    for (let i = 0; i < stroke.dx.length; i++) {
      x += stroke.dx[i];
      y += stroke.dy[i];
      points.push({ x, y });
    }

    return points;
  }
}
