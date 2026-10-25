export type WebPreviewMode = "side" | "window";

export type WebPreviewState = {
  url: string;
  mode: WebPreviewMode;
  threadId: string | null;
};
