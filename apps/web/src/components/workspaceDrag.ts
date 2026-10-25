export const WORKSPACE_DRAG_MIME = "application/x-codex-ui-workspace-entry";

export type WorkspaceDragPayload = {
  name: string;
  path: string;
  kind: "file" | "image";
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

export function buildWorkspaceDragPayload(entry: { isFile: boolean; name: string; path: string }): WorkspaceDragPayload | null {
  if (!entry.isFile) {
    return null;
  }
  return {
    name: entry.name,
    path: entry.path,
    kind: isImagePath(entry.path) ? "image" : "file"
  };
}

export function writeWorkspaceDragData(dataTransfer: DataTransfer, payload: WorkspaceDragPayload): void {
  dataTransfer.setData(WORKSPACE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", payload.path);
  dataTransfer.effectAllowed = "copy";
}

export function readWorkspaceDragData(dataTransfer: DataTransfer): WorkspaceDragPayload | null {
  const raw = dataTransfer.getData(WORKSPACE_DRAG_MIME);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceDragPayload>;
    if ((parsed.kind === "file" || parsed.kind === "image") && typeof parsed.name === "string" && typeof parsed.path === "string") {
      return {
        name: parsed.name,
        path: parsed.path,
        kind: parsed.kind
      };
    }
  } catch {
    return null;
  }
  return null;
}

function isImagePath(path: string): boolean {
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return IMAGE_EXTENSIONS.has(extension);
}
