import { DrawingEngine } from '../DrawingEngine';

export function setupEventListeners(drawingEngine: DrawingEngine): void {
  const canvas = drawingEngine.getCanvas();

  // Mouse events
  canvas.addEventListener('mousedown', (e) => {
    drawingEngine.startDrawing(e);
  });

  canvas.addEventListener('mousemove', (e) => {
    drawingEngine.draw(e);
  });

  canvas.addEventListener('mouseup', () => {
    drawingEngine.stopDrawing();
  });

  canvas.addEventListener('mouseleave', () => {
    drawingEngine.stopDrawing();
  });

  // Touch events for mobile
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    drawingEngine.startDrawing(mouseEvent);
  });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    drawingEngine.draw(mouseEvent);
  });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    drawingEngine.stopDrawing();
  });
}
