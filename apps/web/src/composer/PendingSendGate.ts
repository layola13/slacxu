export class PendingSendGate {
  private readonly cancelled = new Set<string>();
  private readonly committed = new Set<string>();

  cancel(id: string): boolean {
    if (this.committed.has(id)) return false;
    this.cancelled.add(id);
    return true;
  }

  canCommit(id: string): boolean {
    return !this.cancelled.has(id);
  }

  beginCommit(id: string): boolean {
    if (this.cancelled.has(id)) return false;
    this.committed.add(id);
    return true;
  }

  markCommitted(id: string): void {
    this.committed.add(id);
  }

  release(id: string): void {
    this.cancelled.delete(id);
    this.committed.delete(id);
  }
}
