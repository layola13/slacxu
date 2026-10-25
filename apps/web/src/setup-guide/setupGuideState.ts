export const SETUP_GUIDE_VERSION = "v1";
export const SETUP_GUIDE_STORAGE_KEY = `codex-ultra.setup-guide.${SETUP_GUIDE_VERSION}`;

export function hasCompletedSetupGuide(): boolean {
  try {
    return localStorage.getItem(SETUP_GUIDE_STORAGE_KEY) === "completed";
  } catch {
    return false;
  }
}

export function markSetupGuideCompleted(): void {
  try {
    localStorage.setItem(SETUP_GUIDE_STORAGE_KEY, "completed");
  } catch {}
}

export function clearSetupGuideCompleted(): void {
  try {
    localStorage.removeItem(SETUP_GUIDE_STORAGE_KEY);
  } catch {}
}
