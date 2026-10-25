import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { cleanPreviewUrl } from "../../waterfall/chatRows";
import { isBrowserTabAvailable } from "../../clientPlatform";
import type { RightWorkspaceTab } from "../../components/RightWorkspacePanel";
import type { WebPreviewMode, WebPreviewState } from "../../webPreview";

export function useWebPreview(input: {
  activeThreadIdRef: MutableRefObject<string | null>;
  setRightWorkspaceTab: Dispatch<SetStateAction<RightWorkspaceTab>>;
  setRightWorkspaceVisible: Dispatch<SetStateAction<boolean>>;
}) {
  const { activeThreadIdRef, setRightWorkspaceTab, setRightWorkspaceVisible } = input;
  const [webPreview, setWebPreview] = useState<WebPreviewState | null>(null);
  const closeWebPreview = useCallback(() => {
    setWebPreview(null);
    void window.codexUltraDesktop?.closeWebPreview();
  }, []);

  const openBrowserPreview = useCallback((url: string, mode: WebPreviewMode) => {
    void window.codexUltraDesktop?.closeWebPreview();
    const cleanUrl = cleanPreviewUrl(url) ?? url;
    if (mode === "window") {
      setWebPreview({ url: cleanUrl, mode, threadId: activeThreadIdRef.current });
      void window.codexUltraDesktop?.openWebPreview(cleanUrl);
      return;
    }
    // 无内嵌 Browser 页签（服务器浏览器版/非 Windows）：侧览请求回退为新窗口打开，避免切到隐藏页签。
    if (!isBrowserTabAvailable()) {
      setWebPreview({ url: cleanUrl, mode, threadId: activeThreadIdRef.current });
      window.open(cleanUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setWebPreview({ url: cleanUrl, mode, threadId: activeThreadIdRef.current });
    setRightWorkspaceTab("browser");
    setRightWorkspaceVisible(true);
  }, []);
  return { webPreview, setWebPreview, closeWebPreview, openBrowserPreview };
}
