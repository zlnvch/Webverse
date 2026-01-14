import { InternalContentMessageType } from '@shared/messageTypes';

export class CanvasManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 999998;
    `;

    this.ctx = this.canvas.getContext('2d')!;
    this.setupCanvas();
  }

  private setupCanvas() {
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    window.addEventListener('scroll', () => this.render());
    document.body.appendChild(this.canvas);
  }

  private resizeCanvas() {
    const width = Math.max(
      document.documentElement.scrollWidth,
      document.documentElement.offsetWidth,
      document.body.scrollWidth,
      document.body.offsetWidth
    );
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight,
      document.body.scrollHeight,
      document.body.offsetHeight
    );

    this.canvas.width = width;
    this.canvas.height = height;
    this.render();
  }

  private render() {
    // Trigger a re-render by emitting a custom event
    // The DrawingEngine will listen for this
    window.dispatchEvent(new CustomEvent(InternalContentMessageType.RENDER));
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  removeCanvas(): void {
    this.canvas.remove();
  }

  clearCanvas(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
