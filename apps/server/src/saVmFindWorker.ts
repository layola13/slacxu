// Bun.Worker prefilter for find_definition workspace scans.
// Runs disk I/O + substring prefilter off the main event loop; the main
// thread keeps precise tree-sitter parsing (findDefinitionInContent) on
// the few candidates only. Message protocol:
//   inbound: { files: string[]; symbol: string }
//   outbound: { ok: true; matches: string[] } | { ok: false; error: string }
declare const self: {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
};

self.onmessage = async (event: { data: unknown }) => {
  const data = event.data as { files?: unknown; symbol?: unknown };
  try {
    const files = Array.isArray(data.files) ? (data.files as string[]) : [];
    const symbol = typeof data.symbol === "string" ? data.symbol : "";
    if (!symbol || files.length === 0) {
      self.postMessage({ ok: true, matches: [] });
      return;
    }
    const matches: string[] = [];
    for (const f of files) {
      try {
        const text = await Bun.file(f).text();
        if (text.includes(symbol)) matches.push(f);
      } catch {
        // skip unreadable files (deleted/moved mid-scan)
      }
    }
    self.postMessage({ ok: true, matches });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
