import { useState } from "react";
import { Box, Button, Dialog, DialogTitle, DialogContent, Drawer, Typography, Chip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import { helperA, helperB } from "../utils/helpers";
import { RelayConfig, formatRelayName } from "../types";
import DefaultLimit from "../config";

type LocalNotice = { title: string; detail: NoticeDetail };
type NoticeDetail = { code: number; hint: string };
interface PanelStats { turns: number; tokens: number; }

const APP_NAME = "SimApp";
const APP_VERSION = "9.9.9";
let globalCounter = 0;

export function SimulatedApp() {
  const [ready, setReady] = useState(true);
  const [headerTitle, setHeaderTitle] = useState("workbench");
  const [relays, setRelays] = useState<RelayConfig[]>([]);
  const [activeRelayId, setActiveRelayId] = useState("");
  const [relayFilter, setRelayFilter] = useState("");
  const [selectedRelay, setSelectedRelay] = useState<RelayConfig | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<LocalNotice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [themeTuning, setThemeTuning] = useState({ panelOpacity: 0.96 });
  const [draft, setDraft] = useState("");
  const [mention, setMention] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [composerConnected, setComposerConnected] = useState(true);
  const [workingStatus, setWorkingStatus] = useState("idle");
  const [permission, setPermission] = useState("read");
  const [cwd, setCwd] = useState("/tmp/sim");
  const [threads, setThreads] = useState<string[]>([]);
  const [chatTurns, setChatTurns] = useState<string[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [stats, setStats] = useState<PanelStats>({ turns: 0, tokens: 0 });
  const [compactView, setCompactView] = useState(false);
  const [panelPinned, setPanelPinned] = useState(false);
  const versionLabel = `${APP_NAME} v${APP_VERSION}`;
  const relayCount = relays.length;
  const c01 = 1; const c02 = 2; const c03 = 3; const c04 = 4; const c05 = 5;
  const c06 = 6; const c07 = 7; const c08 = 8; const c09 = 9; const c10 = 10;
  const c11 = 11; const c12 = 12; const c13 = 13; const c14 = 14; const c15 = 15;
  const c16 = 16; const c17 = 17; const c18 = 18; const c19 = 19; const c20 = 20;
  const c21 = 21; const c22 = 22; const c23 = 23; const c24 = 24; const c25 = 25;
  const c26 = 26; const c27 = 27; const c28 = 28; const c29 = 29; const c30 = 30;
  const c31 = 31; const c32 = 32; const c33 = 33; const c34 = 34; const c35 = 35;
  const c36 = 36; const c37 = 37; const c38 = 38; const c39 = 39; const c40 = 40;
  const c41 = 41; const c42 = 42; const c43 = 43; const c44 = 44; const c45 = 45;
  const c46 = 46; const c47 = 47; const c48 = 48; const c49 = 49; const c50 = 50;
  const c51 = 51; const c52 = 52; const c53 = 53; const c54 = 54; const c55 = 55;
  const c56 = 56; const c57 = 57; const c58 = 58; const c59 = 59; const c60 = 60;
  function onOpenSettings(section: string) { setDrawerOpen(true); globalCounter += 1; }
  function markRead() { setNotice(null); }
  function sendPrompt(text: string) { setChatTurns((prev) => [...prev, text]); setDraft(""); }
  function steerPrompt(text: string) { setSuggestion(text); }
  function stopActiveTurn() { setWorkingStatus("idle"); }
  function loadOlder() { setHasOlder(false); }
  function openRelay(id: string) { setActiveRelayId(id); }
  function dismissMention() { setMention(null); }
  function toggleCompact() { setCompactView((v) => !v); }
  function renderHeaderBar() {
    // @sim-block-start HeaderBar component=HeaderBarView target=components/HeaderBarView.tsx expect=apply
    return (
      <Box data-testid="header-bar" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="h6">{headerTitle}</Typography>
        <Typography variant="caption">{versionLabel}</Typography>
        <Chip label={ready ? helperA("online") : "offline"} />
        <Button size="small" onClick={() => onOpenSettings("appearance")}>settings</Button>
      </Box>
    );
    // @sim-block-end HeaderBar
  }
  function renderRelayManager() {
    // @sim-block-start RelayManager component=RelayManagerView target=components/RelayManagerView.tsx expect=apply
    return (
      <Box data-testid="relay-manager" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="subtitle1">relays ({relayCount}) limit {DefaultLimit}</Typography>
        <Typography variant="caption">{selectedRelay ? formatRelayName(selectedRelay) : "none"}</Typography>
        <input value={relayFilter} onChange={(e) => setRelayFilter(e.target.value)} placeholder="filter" />
        {relays.filter((r) => r.name.includes(relayFilter)).map((r) => (
          <Box key={r.id} sx={{ display: "flex", gap: 1 }}>
            <Typography>{helperB(r.name)}</Typography>
            <Button size="small" disabled={r.id === activeRelayId} onClick={() => openRelay(r.id)}>use</Button>
          </Box>
        ))}
      </Box>
    );
    // @sim-block-end RelayManager
  }
  function renderFreeModelDialog() {
    // @sim-block-start FreeModelDialog component=FreeModelDialogView target=components/FreeModelDialogView.tsx expect=apply
    return (
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>{notice ? notice.title : "free models"}</DialogTitle>
        <DialogContent>
          <Typography>code {notice ? notice.detail.code : 0} hint {notice ? notice.detail.hint : "-"}</Typography>
          <Typography>{helperA("sync")}</Typography>
          <Button size="small" onClick={markRead}>mark read</Button>
        </DialogContent>
      </Dialog>
    );
    // @sim-block-end FreeModelDialog
  }
  function renderSettingsDrawer() {
    // @sim-block-start SettingsDrawer component=SettingsDrawerView target=components/SettingsDrawerView.tsx expect=apply
    return (
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 300, p: 2, opacity: themeTuning.panelOpacity }}>
          <Typography variant="subtitle1"><SettingsIcon fontSize="small" /> settings</Typography>
          <Typography variant="caption">{versionLabel} relays={relayCount} perm={permission}</Typography>
          <Typography variant="caption">cwd={cwd} status={workingStatus}</Typography>
          <Button size="small" onClick={() => { setThemeTuning({ panelOpacity: 1 }); setPermission("write"); }}>reset</Button>
        </Box>
      </Drawer>
    );
    // @sim-block-end SettingsDrawer
  }
  function renderComposerDock() {
    // @sim-block-start ComposerDock component=ComposerDockView target=components/ComposerDockView.tsx expect=apply
    return (
      <Box data-testid="composer-dock" data-compact={compactView ? "true" : "false"}>
        <Typography variant="caption">{workingStatus} connected={composerConnected ? "y" : "n"}</Typography>
        <Typography variant="caption">{suggestion ?? ""} threads={threads.length}</Typography>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={mention ?? "message"} />
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button size="small" onClick={() => {
            const target = draft.trim();
            const next = target.length > 0 ? target : (suggestion ?? "");
            if (next) sendPrompt(next);
            dismissMention();
          }}>send</Button>
          <Button size="small" onClick={() => {
            const target = suggestion ?? "";
            steerPrompt(target);
          }}>steer</Button>
          <Button size="small" onClick={() => { stopActiveTurn(); toggleCompact(); }}>stop</Button>
        </Box>
      </Box>
    );
    // @sim-block-end ComposerDock
  }
  function renderWorkbenchPanel() {
    // @sim-block-start WorkbenchPanel component=WorkbenchPanelView target=components/WorkbenchPanelView.tsx expect=blocked-tofile
    return (
      <Box data-testid="workbench-panel" data-pinned={panelPinned ? "true" : "false"}>
        <Typography>turns={stats.turns} tokens={stats.tokens} total={[c01, c02, c03, c04, c05, c06, c07, c08, c09, c10, c11, c12, c13, c14, c15, c16, c17, c18, c19, c20, c21, c22, c23, c24, c25, c26, c27, c28, c29, c30, c31, c32, c33, c34, c35, c36, c37, c38, c39, c40, c41, c42, c43, c44, c45, c46, c47, c48, c49, c50, c51, c52, c53, c54, c55, c56, c57, c58, c59, c60].length}</Typography>
        <Button size="small" onClick={() => { setPanelPinned((v) => !v); setStats({ turns: stats.turns + 1, tokens: stats.tokens + c01 + c60 }); }}>pin</Button>
      </Box>
    );
    // @sim-block-end WorkbenchPanel
  }
  function renderChatPanel() {
    // @sim-block-start ChatPanel component=ChatPanelView target=components/ChatPanelView.tsx expect=apply
    return (
      <Box data-testid="chat-panel" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {chatTurns.map((t, i) => (<Typography key={i}>{helperA(t)}</Typography>))}
        <Button size="small" disabled={!hasOlder} onClick={loadOlder}>older</Button>
        <Button size="small" onClick={() => setReady((v) => !v)}>toggle</Button>
      </Box>
    );
    // @sim-block-end ChatPanel
  }
  return (
    <Box sx={{ width: "100%", height: "100%" }}>
      {renderHeaderBar()}
      {renderRelayManager()}
      {renderFreeModelDialog()}
      {renderSettingsDrawer()}
      {renderComposerDock()}
      {renderWorkbenchPanel()}
      {renderChatPanel()}
    </Box>
  );
}
