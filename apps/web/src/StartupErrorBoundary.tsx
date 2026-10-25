import React from "react";

type StartupFailureKind = "mount" | "render" | "runtime" | "promise";

interface FailureDetails {
  code: string;
  message: string;
  diagnostic: string;
}

interface StartupErrorBoundaryState {
  failure: FailureDetails | null;
}

export class StartupErrorBoundary extends React.Component<React.PropsWithChildren, StartupErrorBoundaryState> {
  override state: StartupErrorBoundaryState = { failure: null };

  static getDerivedStateFromError(error: unknown): StartupErrorBoundaryState {
    return { failure: createFailureDetails("render", error) };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const failure = createFailureDetails("render", error, info.componentStack ?? "");
    console.error(`[${failure.code}] React render failed`, error, info);
    this.setState({ failure });
  }

  override render(): React.ReactNode {
    if (this.state.failure) return <StartupFailureScreen failure={this.state.failure} />;
    return this.props.children;
  }
}

function isIgnorableRuntimeError(error: unknown, message?: string): boolean {
  const text = `${message ?? ""} ${error instanceof Error ? error.message : String(error ?? "")}`;
  return /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(text);
}

export function installGlobalErrorDiagnostics(): void {
  window.addEventListener("error", (event) => {
    if (isIgnorableRuntimeError(event.error, event.message)) {
      event.stopImmediatePropagation?.();
      return;
    }
    const error = event.error ?? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`;
    showFailureOverlay(createFailureDetails("runtime", error));
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isIgnorableRuntimeError(event.reason)) {
      return;
    }
    showFailureOverlay(createFailureDetails("promise", event.reason));
  });
}

export function showMountFailure(error: unknown): void {
  showFailureOverlay(createFailureDetails("mount", error));
}

function StartupFailureScreen({ failure }: { failure: FailureDetails }) {
  return (
    <main style={screenStyle} role="alert" data-testid="startup-error-screen">
      <section style={panelStyle}>
        <div style={codeStyle}>{failure.code}</div>
        <h1 style={headingStyle}>Codex Ultra could not start</h1>
        <p style={messageStyle}>{failure.message}</p>
        <div style={actionsStyle}>
          <button type="button" style={primaryButtonStyle} onClick={() => window.location.reload()}>Reload</button>
          <button type="button" style={buttonStyle} onClick={() => void copyDiagnostic(failure.diagnostic)}>Copy diagnostic</button>
        </div>
        <details style={detailsStyle}>
          <summary>Technical details</summary>
          <pre style={preStyle}>{failure.diagnostic}</pre>
        </details>
      </section>
    </main>
  );
}

function createFailureDetails(kind: StartupFailureKind, error: unknown, componentStack = ""): FailureDetails {
  const normalized = normalizeError(error);
  const fingerprint = `${kind}\n${normalized.message}\n${normalized.stack}\n${componentStack}`;
  const code = `UI-${kind.toUpperCase()}-${hashFingerprint(fingerprint)}`;
  const build = document.querySelector<HTMLMetaElement>('meta[name="codex-react-ui-build"]')?.content || "unknown";
  const diagnostic = [
    `Error code: ${code}`,
    `Build: ${build}`,
    `URL: ${window.location.href}`,
    `Time: ${new Date().toISOString()}`,
    `Message: ${normalized.message}`,
    normalized.stack ? `Stack:\n${normalized.stack}` : "",
    componentStack ? `Component stack:${componentStack}` : ""
  ].filter(Boolean).join("\n");
  return { code, message: normalized.message, diagnostic };
}

function normalizeError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name || "Unknown error", stack: error.stack ?? "" };
  }
  if (typeof error === "string") return { message: error || "Unknown error", stack: "" };
  try {
    const serialized = JSON.stringify(error);
    return { message: serialized && serialized !== "{}" ? serialized : String(error), stack: "" };
  } catch {
    return { message: String(error), stack: "" };
  }
}

function hashFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

function showFailureOverlay(failure: FailureDetails): void {
  if (document.querySelector(`[data-startup-error-code="${failure.code}"]`)) return;
  console.error(`[${failure.code}] Unhandled UI failure\n${failure.diagnostic}`);
  const overlay = document.createElement("aside");
  overlay.dataset.startupErrorCode = failure.code;
  overlay.setAttribute("role", "alert");
  overlay.style.cssText = "position:fixed;inset:16px 16px auto auto;z-index:2147483647;width:min(460px,calc(100vw - 32px));box-sizing:border-box;padding:16px;border:1px solid #ef4444;border-radius:8px;background:#fff;color:#111827;box-shadow:0 16px 48px rgba(15,23,42,.28);font:14px/1.5 system-ui,sans-serif";

  const code = document.createElement("strong");
  code.textContent = failure.code;
  code.style.cssText = "display:block;color:#b91c1c;font:700 12px/1.4 ui-monospace,monospace";
  const message = document.createElement("p");
  message.textContent = failure.message;
  message.style.cssText = "margin:8px 0 12px;overflow-wrap:anywhere";
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
  actions.append(createOverlayButton("Copy diagnostic", () => void copyDiagnostic(failure.diagnostic)));
  actions.append(createOverlayButton("Reload", () => window.location.reload()));
  actions.append(createOverlayButton("Dismiss", () => overlay.remove()));
  overlay.append(code, message, actions);
  document.body.append(overlay);
}

function createOverlayButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = "padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#111827;cursor:pointer;font:600 12px/1.2 system-ui,sans-serif";
  button.addEventListener("click", onClick);
  return button;
}

async function copyDiagnostic(diagnostic: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(diagnostic);
  } catch {
    window.prompt("Copy diagnostic", diagnostic);
  }
}

const screenStyle: React.CSSProperties = { minHeight: "100vh", display: "grid", placeItems: "center", boxSizing: "border-box", padding: 24, background: "#f7f9fc", color: "#111827", fontFamily: "system-ui, sans-serif" };
const panelStyle: React.CSSProperties = { width: "min(680px, 100%)", boxSizing: "border-box", padding: 24, border: "1px solid #fecaca", borderRadius: 8, background: "#fff", boxShadow: "0 18px 55px rgba(15, 23, 42, 0.14)" };
const codeStyle: React.CSSProperties = { color: "#b91c1c", fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 800 };
const headingStyle: React.CSSProperties = { margin: "8px 0", fontSize: 24, letterSpacing: 0 };
const messageStyle: React.CSSProperties = { margin: "0 0 18px", color: "#475569", overflowWrap: "anywhere" };
const actionsStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const buttonStyle: React.CSSProperties = { padding: "9px 13px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", color: "#111827", cursor: "pointer", fontWeight: 700 };
const primaryButtonStyle: React.CSSProperties = { ...buttonStyle, borderColor: "#b91c1c", background: "#b91c1c", color: "#fff" };
const detailsStyle: React.CSSProperties = { marginTop: 18, color: "#475569" };
const preStyle: React.CSSProperties = { maxHeight: "38vh", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 12, borderRadius: 6, background: "#0f172a", color: "#e2e8f0", fontSize: 12 };
