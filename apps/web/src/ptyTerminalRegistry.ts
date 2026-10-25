/**
 * Registry of live xterm.js instances by terminal id.
 * Lets the terminal panel drive VSCode-style find/clear on the mounted
 * emulator without touching React state (streaming never re-renders).
 * Implemented on the public xterm buffer API — no search addon required.
 */

export type PtyTerminalHandle = {
  findNext: (query: string, caseSensitive?: boolean) => boolean;
  findPrevious: (query: string, caseSensitive?: boolean) => boolean;
  clearSearchDecorations: () => void;
  clear: () => void;
  focus: () => void;
};

const handles = new Map<string, PtyTerminalHandle>();

export function registerPtyTerminalHandle(terminalId: string, handle: PtyTerminalHandle): () => void {
  handles.set(terminalId, handle);
  return () => {
    if (handles.get(terminalId) === handle) handles.delete(terminalId);
  };
}

export function getPtyTerminalHandle(terminalId: string): PtyTerminalHandle | null {
  return handles.get(terminalId) ?? null;
}

/**
 * Scan the visible buffer for a query and select the next/previous hit.
 * Works with the minimal xterm surface (buffer.active, select, scroll).
 */
export function createBufferSearch(terminal: {
  buffer: { active: { length: number; getLine: (index: number) => { translateToString: (trimRight?: boolean) => string } | undefined } };
  select: (col: number, row: number, length: number) => void;
  clearSelection: () => void;
  scrollToLine: (line: number) => void;
  blur?: () => void;
}): { findNext: (query: string, caseSensitive?: boolean) => boolean; findPrevious: (query: string, caseSensitive?: boolean) => boolean } {
  let cursor = -1;
  let lastQuery = "";
  let lastCaseSensitive = false;

  const collectHits = (query: string, caseSensitive: boolean): Array<{ row: number; col: number; length: number }> => {
    const hits: Array<{ row: number; col: number; length: number }> = [];
    if (!query) return hits;
    const needle = caseSensitive ? query : query.toLowerCase();
    const buffer = terminal.buffer.active;
    for (let row = 0; row < buffer.length; row += 1) {
      const line = buffer.getLine(row);
      if (!line) continue;
      const text = line.translateToString(true);
      const haystack = caseSensitive ? text : text.toLowerCase();
      let from = 0;
      while (from <= haystack.length - needle.length) {
        const col = haystack.indexOf(needle, from);
        if (col < 0) break;
        hits.push({ row, col, length: query.length });
        from = col + Math.max(1, needle.length);
      }
      if (hits.length > 500) break;
    }
    return hits;
  };

  const jump = (query: string, caseSensitive: boolean, direction: 1 | -1): boolean => {
    if (query !== lastQuery || caseSensitive !== lastCaseSensitive) {
      cursor = -1;
      lastQuery = query;
      lastCaseSensitive = caseSensitive;
    }
    const hits = collectHits(query, caseSensitive);
    if (hits.length === 0) {
      terminal.clearSelection();
      return false;
    }
    cursor = direction === 1
      ? (cursor + 1) % hits.length
      : (cursor - 1 + hits.length) % hits.length;
    const hit = hits[cursor]!;
    terminal.select(hit.col, hit.row, hit.length);
    terminal.scrollToLine(hit.row);
    return true;
  };

  return {
    findNext: (query: string, caseSensitive = false) => jump(query, caseSensitive, 1),
    findPrevious: (query: string, caseSensitive = false) => jump(query, caseSensitive, -1)
  };
}
