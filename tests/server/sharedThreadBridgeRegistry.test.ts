import { expect, test } from "bun:test";
import { SharedThreadBridgeRegistry } from "../../apps/server/src/sharedThreadBridgeRegistry.ts";

class FakeBridge {
  public stopCount = 0;

  public stop(): void {
    this.stopCount += 1;
  }
}

test("shared SSH bridge stays alive until its final thread closes", () => {
  const released: FakeBridge[] = [];
  const registry = new SharedThreadBridgeRegistry<FakeBridge>((bridge) => released.push(bridge));
  const bridge = new FakeBridge();
  registry.set("parent", bridge);
  registry.set("child", bridge);

  expect(registry.release("parent")).toEqual({ released: true, bridgeStopped: false, remainingReferences: 1 });
  expect(bridge.stopCount).toBe(0);
  expect(released).toEqual([]);

  expect(registry.release("child")).toEqual({ released: true, bridgeStopped: true, remainingReferences: 0 });
  expect(bridge.stopCount).toBe(1);
  expect(released).toEqual([bridge]);
});

test("closing an SSH thread bridge is idempotent", () => {
  const bridge = new FakeBridge();
  const registry = new SharedThreadBridgeRegistry<FakeBridge>();
  registry.set("thread", bridge);

  expect(registry.release("thread").bridgeStopped).toBe(true);
  expect(registry.release("thread")).toEqual({ released: false, bridgeStopped: false, remainingReferences: 0 });
  expect(bridge.stopCount).toBe(1);
});

test("final release callback runs after the bridge is stopped", () => {
  const bridge = new FakeBridge();
  let observedStopCount = 0;
  const registry = new SharedThreadBridgeRegistry<FakeBridge>((releasedBridge) => {
    observedStopCount = releasedBridge.stopCount;
  });
  registry.set("thread", bridge);

  registry.release("thread");

  expect(observedStopCount).toBe(1);
});
