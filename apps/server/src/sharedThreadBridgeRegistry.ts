export type StoppableBridge = {
  stop(): void;
};

export type ThreadBridgeReleaseResult = {
  released: boolean;
  bridgeStopped: boolean;
  remainingReferences: number;
};

export class SharedThreadBridgeRegistry<Bridge extends StoppableBridge> {
  private readonly bridges = new Map<string, Bridge>();

  public constructor(private readonly onLastRelease?: (bridge: Bridge) => void) {}

  public get(threadId: string): Bridge | undefined {
    return this.bridges.get(threadId);
  }

  public set(threadId: string, bridge: Bridge): void {
    this.bridges.set(threadId, bridge);
  }

  public values(): IterableIterator<Bridge> {
    return this.bridges.values();
  }

  public entries(): IterableIterator<[string, Bridge]> {
    return this.bridges.entries();
  }

  public release(threadId: string): ThreadBridgeReleaseResult {
    const bridge = this.bridges.get(threadId);
    if (!bridge) {
      return { released: false, bridgeStopped: false, remainingReferences: 0 };
    }

    this.bridges.delete(threadId);
    let remainingReferences = 0;
    for (const candidate of this.bridges.values()) {
      if (candidate === bridge) remainingReferences += 1;
    }
    if (remainingReferences > 0) {
      return { released: true, bridgeStopped: false, remainingReferences };
    }

    bridge.stop();
    this.onLastRelease?.(bridge);
    return { released: true, bridgeStopped: true, remainingReferences: 0 };
  }
}
