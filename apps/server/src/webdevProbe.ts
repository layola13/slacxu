export type WebDevProbeResult = {
  ok: boolean;
  url: string;
  status?: number;
  contentType?: string;
  title?: string;
  elapsedMs: number;
  error?: string;
};

const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeLocalPreviewTarget(value: string): URL {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Missing preview URL");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("Preview URL must use http or https");
  }
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Preview URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Preview URL must not include credentials");
  }
  if (!LOCAL_PREVIEW_HOSTS.has(url.hostname)) {
    throw new Error("Preview probe only supports localhost, 127.0.0.1, or [::1]");
  }
  return url;
}

export async function probeWebDevPreviewUrl(value: string, timeoutMs = 5_000): Promise<WebDevProbeResult> {
  const startedAt = Date.now();
  let url: URL;
  try {
    url = normalizeLocalPreviewTarget(value);
  } catch (error) {
    return {
      ok: false,
      url: value,
      elapsedMs: Date.now() - startedAt,
      error: errorToMessage(error)
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": "codex-ui-webdev-preview-probe"
      }
    });
    const contentType = response.headers.get("content-type") ?? undefined;
    const title = contentType?.toLowerCase().includes("text/html")
      ? extractHtmlTitle(await response.text().catch(() => ""))
      : undefined;
    return {
      ok: response.status >= 200 && response.status < 400,
      url: url.toString(),
      status: response.status,
      contentType,
      title,
      elapsedMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      url: url.toString(),
      elapsedMs: Date.now() - startedAt,
      error: errorToMessage(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractHtmlTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) {
    return undefined;
  }
  return decodeHtmlText(match[1] ?? "").trim().slice(0, 160) || undefined;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
