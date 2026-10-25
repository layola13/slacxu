import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChatWaterfallRow } from "./types";

const CARD_HEIGHT = 104;
const GRID_GAP = 8;

type Props = {
  rows: ChatWaterfallRow[];
  before?: ReactNode;
  resetKey: string;
  initialScrollTop?: number;
  interactive?: boolean;
  onOpenAgent: (agentId: string) => void;
  onScrollPositionChange?: (scrollTop: number) => void;
};

export function AgentOverviewGrid({
  rows,
  before,
  resetKey,
  initialScrollTop,
  interactive = true,
  onOpenAgent,
  onScrollPositionChange,
}: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [lanes, setLanes] = useState(1);
  const resetKeyRef = useRef(resetKey);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: () => CARD_HEIGHT,
    gap: GRID_GAP,
    lanes,
    overscan: lanes * 2,
    initialOffset: () => initialScrollTop ?? 0,
  });
  const virtualRows = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const update = (width: number) => setLanes((current) => {
      const next = overviewLaneCount(width);
      return current === next ? current : next;
    });
    update(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => update(entry?.contentRect.width ?? element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Handle virtual-page switches without a full remount: the parent keeps a
  // stable instance and swaps resetKey. Save the outgoing scroll position and
  // restore the incoming one after paint so tab switches skip Fiber/DOM
  // teardown plus a synchronous measure before first paint.
  useLayoutEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    const previousElement = parentRef.current;
    if (previousElement) scrollPositionsRef.current.set(resetKeyRef.current, previousElement.scrollTop);
    resetKeyRef.current = resetKey;
    const savedPosition = scrollPositionsRef.current.get(resetKey) ?? initialScrollTop ?? 0;
    const frame = window.requestAnimationFrame(() => {
      const element = parentRef.current;
      if (!element) return;
      virtualizer.measure();
      element.scrollTop = savedPosition;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialScrollTop, resetKey, virtualizer]);

  useEffect(() => () => {
    const element = parentRef.current;
    if (element) scrollPositionsRef.current.set(resetKeyRef.current, element.scrollTop);
  }, []);

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [lanes, virtualizer]);

  useEffect(() => {
    const element = parentRef.current;
    if (!element || !interactive || !onScrollPositionChange) return;
    let frame = 0;
    const report = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        onScrollPositionChange(element.scrollTop);
      });
    };
    element.addEventListener("scroll", report, { passive: true });
    return () => {
      element.removeEventListener("scroll", report);
      window.cancelAnimationFrame(frame);
      onScrollPositionChange(element.scrollTop);
    };
  }, [interactive, onScrollPositionChange]);

  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: before ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)" }}>
      {before && <Box sx={{ px: { xs: 1.25, sm: 2 }, pt: 1.25, pb: 0.75 }}>{before}</Box>}
      <Box
        ref={parentRef}
        data-testid="chat-waterfall-scroll"
        data-virtual-page-key={resetKey}
        data-agent-overview-lanes={lanes}
        sx={{ minHeight: 0, overflow: "auto", px: { xs: 1.25, sm: 2 }, pb: 2 }}
      >
        <Box
          data-testid="conversation-waterfall"
          data-virtual-page-key={resetKey}
          data-row-count={rows.length}
          data-pinned-live-row-count="0"
          data-agent-overview-grid="true"
          sx={{ position: "relative", width: "100%", height: virtualizer.getTotalSize(), maxWidth: 1600, mx: "auto" }}
        >
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            const width = `calc((100% - ${(lanes - 1) * GRID_GAP}px) / ${lanes})`;
            const lane = virtualRow.lane ?? 0;
            return (
              <Box
                key={row.key}
                data-chat-row-key={row.key}
                data-testid={`agent-overview-row-${sanitizeTestId(row.item.agentId ?? row.threadId)}`}
                sx={{
                  position: "absolute",
                  top: 0,
                  left: `calc(${(lane * 100) / lanes}% + ${(lane * GRID_GAP) / lanes}px)`,
                  width,
                  height: CARD_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <AgentOverviewCard row={row} onOpenAgent={onOpenAgent} />
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

const AgentOverviewCard = memo(function AgentOverviewCard({ row, onOpenAgent }: {
  row: ChatWaterfallRow;
  onOpenAgent: (agentId: string) => void;
}) {
  const agentId = row.item.agentId ?? row.threadId;
  return (
    <Paper
      component="button"
      type="button"
      variant="outlined"
      onClick={() => onOpenAgent(agentId)}
      aria-label={`Open agent ${row.title}`}
      sx={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        p: 1.1,
        borderRadius: 1,
        color: "text.primary",
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.72 : 0.92),
        borderColor: row.isLive ? "primary.main" : "divider",
        boxShadow: row.isLive ? (theme) => `inset 3px 0 0 ${theme.palette.primary.main}` : "none",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
        overflow: "hidden",
        "&:hover": { bgcolor: "action.hover", borderColor: row.isLive ? "primary.light" : "text.disabled" },
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
        <Box
          aria-hidden="true"
          sx={{ width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto", bgcolor: row.isLive ? "success.main" : "text.disabled" }}
        />
        <Typography variant="subtitle2" noWrap sx={{ minWidth: 0, flex: 1, fontWeight: 850 }}>
          {row.title}
        </Typography>
        <Chip size="small" label={displayStatus(row.status)} sx={{ height: 20, maxWidth: 92, "& .MuiChip-label": { px: 0.75, overflow: "hidden", textOverflow: "ellipsis" } }} />
        <ChevronRightIcon sx={{ fontSize: 17, color: "text.disabled", flex: "0 0 auto" }} />
      </Stack>
      {row.item.agentRole && (
        <Typography variant="caption" noWrap color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
          {row.item.agentRole}
        </Typography>
      )}
      <Typography
        variant="body2"
        color={row.text ? "text.primary" : "text.disabled"}
        sx={{
          mt: 0.4,
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: row.item.agentRole ? 2 : 3,
          overflow: "hidden",
          overflowWrap: "anywhere",
        }}
      >
        {row.text || "Waiting for output"}
      </Typography>
    </Paper>
  );
}, (previous, next) => previous.row === next.row && previous.onOpenAgent === next.onOpenAgent);

export function overviewLaneCount(width: number): number {
  if (width >= 980) return 3;
  if (width >= 520) return 2;
  return 1;
}

function displayStatus(status?: string): string {
  if (!status) return "waiting";
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function sanitizeTestId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-");
}
