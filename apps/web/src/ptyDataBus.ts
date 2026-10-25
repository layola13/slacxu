// Minimal pub/sub routing raw PTY bytes from App's notification handler to
// the mounted xterm.js instance. xterm owns its buffer; React state only
// tracks session identity/status, so streaming never re-renders.

type DataListener = (chunk: string) => void;
type ExitListener = (exitCode: number) => void;

const dataListeners = new Map<string, Set<DataListener>>();
const exitListeners = new Map<string, Set<ExitListener>>();

export function subscribePtyTerminal(
  terminalId: string,
  onData: DataListener,
  onExit: ExitListener
): () => void {
  let dataSet = dataListeners.get(terminalId);
  if (!dataSet) {
    dataSet = new Set();
    dataListeners.set(terminalId, dataSet);
  }
  dataSet.add(onData);
  let exitSet = exitListeners.get(terminalId);
  if (!exitSet) {
    exitSet = new Set();
    exitListeners.set(terminalId, exitSet);
  }
  exitSet.add(onExit);
  return () => {
    dataListeners.get(terminalId)?.delete(onData);
    exitListeners.get(terminalId)?.delete(onExit);
  };
}

export function publishPtyData(terminalId: string, chunk: string): void {
  for (const listener of dataListeners.get(terminalId) ?? []) {
    try {
      listener(chunk);
    } catch {
      // A broken view must not break the bus.
    }
  }
}

export function publishPtyExit(terminalId: string, exitCode: number): void {
  for (const listener of exitListeners.get(terminalId) ?? []) {
    try {
      listener(exitCode);
    } catch {
      // A broken view must not break the bus.
    }
  }
}
