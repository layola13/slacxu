export function isThreadWriterConflict(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  return /thread-store conflict|already has an active writer|open in another Codex Ultra instance/i.test(message);
}
