import { Stroke } from '@shared/types';

export class StrokeManager {
  private confirmedStrokes: Stroke[] = [];
  private confirmedStrokesDict: Map<string, Stroke> = new Map();
  private unconfirmedStrokes: Map<number, Stroke> = new Map();
  private pendingRedoStrokes: Map<number, Stroke> = new Map();

  // Callbacks for rendering and notifications
  private onRender: () => void;
  private onNotifyToolbar: () => void;

  constructor(onRender: () => void, onNotifyToolbar: () => void) {
    this.onRender = onRender;
    this.onNotifyToolbar = onNotifyToolbar;
  }

  setStrokes(strokes: Stroke[]) {
    // console.log(`📦 Loading ${strokes.length} strokes from server`);
    this.confirmedStrokes = strokes;

    // Build dictionary
    this.confirmedStrokesDict.clear();
    for (const stroke of this.confirmedStrokes) {
      this.confirmedStrokesDict.set(stroke.id, stroke);
    }

    this.triggerRender();
  }

  // Find the correct insertion index for a stroke based on UUIDv7 timestamp order
  // Does a linear search from the end (efficient since most strokes are inserted at the end)
  private findInsertIndex(strokeId: string): number {
    // Start from the end and work backwards
    for (let i = this.confirmedStrokes.length - 1; i >= 0; i--) {
      if (this.confirmedStrokes[i].id < strokeId) {
        return i + 1;
      }
    }
    // If we didn't find any stroke with a smaller ID, insert at the beginning
    return 0;
  }

  // Insert a stroke in the correct position based on UUIDv7 order
  private insertStrokeInOrder(stroke: Stroke) {
    const insertIndex = this.findInsertIndex(stroke.id);
    this.confirmedStrokes.splice(insertIndex, 0, stroke);
    this.confirmedStrokesDict.set(stroke.id, stroke);
  }

  confirmStroke(userStrokeId: number, strokeId: string) {
    const stroke = this.unconfirmedStrokes.get(userStrokeId);
    if (!stroke) {
      return;
    }

    // console.log(`✅ Confirming stroke ${userStrokeId} -> ${strokeId}`);

    // Update stroke with real ID from backend
    stroke.id = strokeId;

    // Move from unconfirmed to confirmed (in correct order based on UUIDv7)
    this.unconfirmedStrokes.delete(userStrokeId);
    this.insertStrokeInOrder(stroke);

    this.triggerRender();
  }

  confirmRedo(userStrokeId: number, strokeId: string) {
    // console.log(`✅ Confirming redo ${userStrokeId} -> ${strokeId}`);

    // Look up the stroke from pending redo strokes
    const stroke = this.pendingRedoStrokes.get(userStrokeId);
    if (!stroke) {
      // console.warn(`⚠️ Pending redo stroke ${userStrokeId} not found`);
      return;
    }

    // For redo, the stroke was already added to confirmedStrokes optimistically
    // Now we need to update its ID from the old server ID to the new one
    const oldId = stroke.id;
    stroke.id = strokeId;

    // Update the dictionary
    this.confirmedStrokesDict.delete(oldId);
    this.confirmedStrokesDict.set(strokeId, stroke);

    // Remove from pending redo strokes
    this.pendingRedoStrokes.delete(userStrokeId);

    // console.log(`✅ Redo confirmed: ${oldId} -> ${strokeId}`);
    this.triggerRender();
  }

  addStrokeFromServer(stroke: Stroke) {
    // Check if stroke already exists (avoid duplicates)
    if (this.confirmedStrokesDict.has(stroke.id)) {
      return;
    }

    // Check if this is in unconfirmed (waiting for draw_response)
    // If so, ignore - draw_response will handle it
    for (const [_, unconfirmedStroke] of this.unconfirmedStrokes.entries()) {
      // We can't directly compare since unconfirmed doesn't have real UUID yet
      // But if we get here, it means the stroke was confirmed, so we can rely on
      // draw_response to move it to confirmed
      if (unconfirmedStroke.dx.length === stroke.dx.length) {
        return;
      }
    }

    // Add to confirmed in the correct position based on UUIDv7 order
    this.insertStrokeInOrder(stroke);

    this.triggerRender();
  }

  deleteStroke(strokeId: string, userId: string) {
    const stroke = this.confirmedStrokesDict.get(strokeId);
    if (!stroke) {
      // Stroke doesn't exist in confirmed strokes
      // This is expected for the tab that performed the undo (it's in redoStack)
      return;
    }

    // Verify that the stroke's userId matches the userId in the message
    if (stroke.userId !== userId) {
      // console.warn(`⚠️ Stroke userId mismatch: ${stroke.userId} != ${userId}`);
      return;
    }

    // Remove from confirmed strokes and dictionary
    const index = this.confirmedStrokes.findIndex(s => s.id === strokeId);
    if (index !== -1) {
      this.confirmedStrokes.splice(index, 1);
      this.confirmedStrokesDict.delete(strokeId);
      // console.log(`🗑️ Deleted stroke ${strokeId} from confirmed strokes`);
      this.triggerRender();
    }
  }

  clear() {
    this.confirmedStrokes = [];
    this.confirmedStrokesDict.clear();
    this.unconfirmedStrokes.clear();
    this.pendingRedoStrokes.clear();
    this.triggerRender();
  }

  private triggerRender() {
    this.onRender();
    this.onNotifyToolbar();
  }

  // Getters
  getConfirmedStrokes(): Stroke[] {
    return this.confirmedStrokes;
  }

  getUnconfirmedStrokes(): Map<number, Stroke> {
    return this.unconfirmedStrokes;
  }

  getPendingRedoStrokes(): Map<number, Stroke> {
    return this.pendingRedoStrokes;
  }

  addUnconfirmedStroke(userStrokeId: number, stroke: Stroke) {
    this.unconfirmedStrokes.set(userStrokeId, stroke);
  }

  addPendingRedoStroke(userStrokeId: number, stroke: Stroke) {
    this.pendingRedoStrokes.set(userStrokeId, stroke);
  }

  removeUnconfirmedStroke(userStrokeId: number) {
    const stroke = this.unconfirmedStrokes.get(userStrokeId);
    if (!stroke) {
      // console.warn(`⚠️ Unconfirmed stroke ${userStrokeId} not found for removal`);
      return;
    }

    // console.log(`❌ Removing unconfirmed stroke ${userStrokeId} due to failed draw_response`);
    this.unconfirmedStrokes.delete(userStrokeId);
    this.triggerRender();
  }

  removePendingRedoStroke(userStrokeId: number) {
    const stroke = this.pendingRedoStrokes.get(userStrokeId);
    if (!stroke) {
      // console.warn(`⚠️ Pending redo stroke ${userStrokeId} not found for removal`);
      return;
    }

    // console.log(`❌ Removing pending redo stroke ${userStrokeId} due to failed redo_response`);

    // Remove from pending redo strokes
    this.pendingRedoStrokes.delete(userStrokeId);

    // Also remove from confirmed strokes (since it was optimistically added)
    const index = this.confirmedStrokes.findIndex(s => s.id === stroke.id);
    if (index !== -1) {
      this.confirmedStrokes.splice(index, 1);
      this.confirmedStrokesDict.delete(stroke.id);
      // console.log(`❌ Removed stroke ${stroke.id} from confirmed strokes`);
    }

    this.triggerRender();
  }
}
