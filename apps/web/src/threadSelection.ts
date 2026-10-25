type MutableValue<T> = { current: T };

export type ThreadSelection = {
  epoch: number;
  threadId: string;
};

export function beginThreadSelection(
  epochRef: MutableValue<number>,
  activeThreadIdRef: MutableValue<string | null>,
  threadId: string
): ThreadSelection {
  const epoch = epochRef.current + 1;
  epochRef.current = epoch;
  activeThreadIdRef.current = threadId;
  return { epoch, threadId };
}

export function isThreadSelectionCurrent(
  selection: ThreadSelection,
  epochRef: MutableValue<number>,
  activeThreadIdRef: MutableValue<string | null>
): boolean {
  return selection.epoch === epochRef.current && selection.threadId === activeThreadIdRef.current;
}

export function shouldRenderCachedTranscript(input: {
  hasCachedTranscript: boolean;
  selectionEpoch: number;
  currentEpoch: number;
  threadId: string;
  activeThreadId: string | null;
}): boolean {
  return input.hasCachedTranscript
    && input.selectionEpoch === input.currentEpoch
    && input.threadId === input.activeThreadId;
}
