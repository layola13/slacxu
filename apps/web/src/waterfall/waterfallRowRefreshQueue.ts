import type { ChatWaterfallRow } from "./types";

export class WaterfallRowRefreshQueue {
  private appliedRows: ChatWaterfallRow[];
  private pendingRows: ChatWaterfallRow[] | null = null;
  private inFlight = false;

  constructor(initialRows: ChatWaterfallRow[]) {
    this.appliedRows = initialRows;
  }

  enqueue(nextRows: ChatWaterfallRow[]): boolean {
    if (nextRows === this.appliedRows || nextRows === this.pendingRows) {
      return false;
    }
    this.pendingRows = nextRows;
    return true;
  }

  beginFlush(): ChatWaterfallRow[] | null {
    if (this.inFlight || !this.pendingRows || this.pendingRows === this.appliedRows) {
      return null;
    }
    const nextRows = this.pendingRows;
    this.pendingRows = null;
    this.inFlight = true;
    return nextRows;
  }

  markApplied(rows: ChatWaterfallRow[]): void {
    this.appliedRows = rows;
    this.inFlight = false;
  }

  hasPending(): boolean {
    return this.pendingRows !== null && this.pendingRows !== this.appliedRows;
  }

  reset(initialRows: ChatWaterfallRow[]): void {
    this.appliedRows = initialRows;
    this.pendingRows = null;
    this.inFlight = false;
  }
}
