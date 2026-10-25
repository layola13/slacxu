// 客户端平台判断：内嵌 Browser 页签仅在 Windows 桌面端可用。
// - 服务器浏览器版（window 上无 codexUltraDesktop 桥）一律隐藏：外部网站常被
//   X-Frame-Options/CSP 拦截，内嵌 guerr 无用，预览统一走新窗口（见 App.openBrowserPreview 回退）。
// - 非 Windows（含 macOS/Linux 桌面端）一律隐藏。
// SSR 安全：无 navigator 时返回空字符串；无 window 时退化为纯平台判断，
// 保持服务端渲染与单测行为稳定。

export function clientPlatformString(): string {
  if (typeof navigator === "undefined") return "";
  const withUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return withUserAgentData.userAgentData?.platform ?? navigator.platform ?? "";
}

export function isLinuxClient(platform: string = clientPlatformString()): boolean {
  return /linux/i.test(platform);
}

export function isWindowsClient(platform: string = clientPlatformString()): boolean {
  return /win/i.test(platform);
}

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && !!(window as Window & { codexUltraDesktop?: unknown }).codexUltraDesktop;
}

// 右侧 Browser 页签是否可用：仅 Windows 桌面端保留；服务器浏览器版与非 Windows 一律隐藏。
export function isBrowserTabAvailable(platform: string = clientPlatformString()): boolean {
  if (typeof window !== "undefined" && !isDesktopShell()) {
    return false;
  }
  return isWindowsClient(platform);
}
