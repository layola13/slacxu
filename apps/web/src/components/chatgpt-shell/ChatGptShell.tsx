import { memo, useRef, type ReactNode } from "react";
import { ThemeProvider } from "@mui/material/styles";
import SettingsIcon from "@mui/icons-material/Settings";
import FlagIcon from "@mui/icons-material/Flag";
import type { PendingServerRequest } from "../../state/codexClient";
import { ChatWaterfall } from "../../waterfall/ChatWaterfall";
import type { ChatWaterfallRow } from "../../waterfall/types";
import type { TranslateFn } from "../../i18n";
import { chatgptMuiTheme } from "./chatgpt-mui-theme";
import "./chatgpt-tokens.css";

type Props = {
  rows: ChatWaterfallRow[];
  activeThreadId: string | null;
  running: boolean;
  cwd: string;
  goalLabel?: string | null;
  pendingRequests?: PendingServerRequest[];
  hasOlderHistory?: boolean;
  loadingOlderHistory?: boolean;
  t: TranslateFn;
  composer?: ReactNode;
  onOpenSettings?: () => void;
  onAnswerServerRequest?: (requestId: string | number, response: Record<string, unknown>) => void;
  onLoadOlderHistory?: () => void;
  onUndoFileChanges?: (rows: ChatWaterfallRow[]) => void;
  onReviewFileChanges?: (rows: ChatWaterfallRow[]) => void;
};

const CHAT_HOME_HERO_KEYS = [
  "chatgptShell.hero.readyWhenYouAre",
  "chatgptShell.hero.onYourMind",
  "chatgptShell.hero.agendaToday",
  "chatgptShell.hero.shouldWeBegin",
] as const;

function ChatHomeHero({ locationKey, t }: { locationKey: string; t: TranslateFn }) {
  const lastLocation = useRef(locationKey);
  const index = useRef(0);
  if (lastLocation.current !== locationKey) {
    index.current = (index.current + 1) % CHAT_HOME_HERO_KEYS.length;
    lastLocation.current = locationKey;
  }
  const headline = t(CHAT_HOME_HERO_KEYS[index.current] ?? CHAT_HOME_HERO_KEYS[0]);
  return (
    <div className="mx-auto w-[min(100%,var(--thread-content-max-width))] min-w-0 px-panel">
      <div className="relative w-full min-w-0 text-center select-none" style={{ viewTransitionName: "var(--vt-splash-screen-headline)" }}>
        <h1 aria-hidden className="heading-xl invisible font-normal whitespace-pre-wrap">{headline}</h1>
        <h1 key={`${locationKey}|${headline}`} className="cgpt-hero-headline-visible heading-xl font-normal whitespace-pre-wrap text-token-foreground absolute inset-x-0 bottom-0">{headline}</h1>
      </div>
    </div>
  );
}

function AnswerPromptCard({ request, t, onAnswer }: { request: PendingServerRequest; t: TranslateFn; onAnswer?: Props["onAnswerServerRequest"] }) {
  const params = (request.params ?? {}) as Record<string, unknown>;
  let detail = "";
  try { detail = JSON.stringify(params, null, 2); } catch { detail = String(params); }
  return (
    <div className="chatgpt-tool-approval" style={{ margin: "0.75rem auto", maxWidth: 768, padding: "0.75rem 1rem" }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-token-bg-secondary text-token-text-secondary"><SettingsIcon sx={{ fontSize: 16 }} /></span>
        <div className="min-w-0"><div className="min-w-0 truncate font-medium text-token-foreground">{String(request.method)}</div>{request.id != null && <div className="text-size-chat-sm text-token-text-tertiary">#{String(request.id)}</div>}</div>
      </div>
      <pre className="text-size-chat-sm text-token-text-secondary break-words" style={{ maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--font-mono)", fontSize: 12 }}>{detail}</pre>
      <div className="flex gap-2 mt-2 justify-end">
        <button type="button" className="rounded-md border border-token-border-heavy px-3 py-1.5 text-size-chat-sm text-token-foreground cursor-interaction hover:bg-token-list-hover-background" onClick={() => onAnswer?.(request.id, { approved: true })}>{t("chatgptShell.asked")}</button>
        <button type="button" className="rounded-md px-3 py-1.5 text-size-chat-sm text-token-foreground cursor-interaction chatgpt-submit" style={{ background: "var(--color-token-foreground)", color: "var(--color-token-bg-primary)" }} onClick={() => onAnswer?.(request.id, { approved: false })}>{t("chatgptShell.needsInput")}</button>
      </div>
    </div>
  );
}

function ChatGptShellImpl(props: Props) {
  const before = props.pendingRequests?.length ? <>{props.pendingRequests.map((request) => <AnswerPromptCard key={request.id} request={request} t={props.t} onAnswer={props.onAnswerServerRequest} />)}</> : undefined;
  const showWelcome = props.rows.length === 0 && !props.running;
  return (
    <ThemeProvider theme={chatgptMuiTheme}>
      <div className="cgpt-root chatgpt-conversation" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
        <header className="flex items-center gap-2 border-b border-token-border bg-token-main-surface-primary" style={{ paddingInline: "1rem", paddingBlock: "0.5rem", minHeight: 48, flexShrink: 0 }}>
          {props.goalLabel && <span className="inline-flex items-center gap-1 rounded-full border border-token-border-heavy px-2 py-0.5 text-size-chat-sm text-token-foreground"><FlagIcon sx={{ fontSize: 14 }} /><span className="truncate" style={{ maxWidth: 200 }}>{props.goalLabel}</span></span>}
          {props.running && <span className="text-size-chat-sm text-token-text-secondary">{props.t("chatgptShell.working")}</span>}
          <span style={{ flex: 1 }} />
          {props.cwd && <span className="text-size-chat-sm text-token-text-tertiary truncate" style={{ maxWidth: "50%" }} title={props.cwd}>{props.cwd}</span>}
          {props.onOpenSettings && <button type="button" onClick={props.onOpenSettings} className="flex items-center justify-center rounded-md border border-transparent cursor-interaction hover:bg-token-list-hover-background" style={{ width: 32, height: 32, background: "transparent", color: "var(--color-token-text-secondary)" }} aria-label={props.t("settings.nav.appearance")}><SettingsIcon sx={{ fontSize: 18 }} /></button>}
        </header>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {showWelcome ? (
            <div className="thread-scroll-container" style={{ flex: 1, overflowY: "auto", paddingBlock: "0.75rem" }}><div style={{ maxWidth: "min(100%, var(--thread-content-max-width))", marginInline: "auto", paddingInline: "var(--padding-panel)" }}><div style={{ paddingTop: "min(30vh, 168px)", paddingBottom: "1.5rem", textAlign: "center" }}><ChatHomeHero locationKey={props.activeThreadId ?? "default"} t={props.t} /></div>{before}</div></div>
          ) : <ChatWaterfall rows={props.rows} t={props.t} before={before} resetKey={props.activeThreadId ?? "default"} hasOlder={Boolean(props.hasOlderHistory)} loadingOlder={Boolean(props.loadingOlderHistory)} onReachTop={props.onLoadOlderHistory} variant="official" onUndoFileChanges={props.onUndoFileChanges} onReviewFileChanges={props.onReviewFileChanges} />}
        </div>
        {props.composer}
      </div>
    </ThemeProvider>
  );
}

export const ChatGptShell = memo(ChatGptShellImpl);
export { ChatGptShellImpl };
