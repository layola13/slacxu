/** Runtime flavor detection (R2: owned by the SDK). */
export const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
export const isNodeRuntime = !isBunRuntime;
