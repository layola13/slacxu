import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, ButtonBase, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { useVirtualizer } from "@tanstack/react-virtual";

export type ChatFloorEntry = {
  rowIndex: number;
  index: number;
  label: string;
};

type Props = {
  floors: ChatFloorEntry[];
  activeFloorIndex: number | null;
  onJump: (rowIndex: number) => void;
};

type DragSession = {
  pointerId: number;
  startY: number;
  startOffset: number;
  maxOffset: number;
  nextOffset: number;
};

const COLLAPSED_STORAGE_KEY = "codex-ultra:prompt-rail-collapsed";
const OFFSET_STORAGE_KEY = "codex-ultra:prompt-rail-offset";

export const ChatFloorRail = memo(function ChatFloorRail({ floors, activeFloorIndex, onJump }: Props) {
  const paperRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressAutoFollowUntilRef = useRef(0);
  const [collapsed, setCollapsed] = useState(() => readStoredBoolean(COLLAPSED_STORAGE_KEY, false));
  const [verticalOffset, setVerticalOffset] = useState(() => readStoredNumber(OFFSET_STORAGE_KEY, 0));
  const [dragging, setDragging] = useState(false);
  const virtualizer = useVirtualizer({
    count: floors.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => floors[index]?.index ?? index,
    estimateSize: () => 27,
    overscan: 6
  });
  const activeListIndex = activeFloorIndex == null ? -1 : floors.findIndex((floor) => floor.index === activeFloorIndex);

  useEffect(() => {
    if (collapsed || activeListIndex < 0 || performance.now() < suppressAutoFollowUntilRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      virtualizer.scrollToIndex(activeListIndex, { align: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeListIndex, collapsed, virtualizer]);

  useEffect(() => {
    const clampOffset = () => {
      const paper = paperRef.current;
      const container = paper?.closest<HTMLElement>('[data-testid="chat-waterfall-scroll"]');
      if (!paper || !container) {
        return;
      }
      const nextOffset = clamp(verticalOffset, 0, Math.max(0, container.clientHeight - paper.offsetHeight - 24));
      if (nextOffset !== verticalOffset) {
        setVerticalOffset(nextOffset);
        storeNumber(OFFSET_STORAGE_KEY, nextOffset);
      }
    };
    clampOffset();
    window.addEventListener("resize", clampOffset);
    return () => window.removeEventListener("resize", clampOffset);
  }, [collapsed, verticalOffset]);

  useEffect(() => {
    const cancelDrag = () => {
      const session = dragSessionRef.current;
      if (!session) return;
      dragSessionRef.current = null;
      const handle = paperRef.current?.querySelector<HTMLElement>('[data-testid="chat-floor-drag-handle"]');
      if (handle?.hasPointerCapture(session.pointerId)) handle.releasePointerCapture(session.pointerId);
      if (paperRef.current) paperRef.current.style.transform = `translateY(${verticalOffset}px)`;
      setDragging(false);
    };
    const onVisibilityChange = () => { if (document.visibilityState !== "visible") cancelDrag(); };
    window.addEventListener("blur", cancelDrag);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelDrag();
      window.removeEventListener("blur", cancelDrag);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [verticalOffset]);

  if (floors.length < 2) {
    return null;
  }

  const toggleCollapsed = () => {
    const next = !collapsed;
    suppressAutoFollowUntilRef.current = performance.now() + 800;
    setCollapsed(next);
    storeBoolean(COLLAPSED_STORAGE_KEY, next);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    const paper = paperRef.current;
    const container = paper?.closest<HTMLElement>('[data-testid="chat-waterfall-scroll"]');
    if (!paper || !container) {
      return;
    }
    const maxOffset = Math.max(0, container.clientHeight - paper.offsetHeight - 24);
    const startOffset = clamp(verticalOffset, 0, maxOffset);
    dragSessionRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset,
      maxOffset,
      nextOffset: startOffset
    };
    suppressAutoFollowUntilRef.current = performance.now() + 1_200;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    const paper = paperRef.current;
    if (!session || session.pointerId !== event.pointerId || !paper) {
      return;
    }
    session.nextOffset = clamp(session.startOffset + event.clientY - session.startY, 0, session.maxOffset);
    paper.style.transform = `translateY(${session.nextOffset}px)`;
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    dragSessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setVerticalOffset(session.nextOffset);
    storeNumber(OFFSET_STORAGE_KEY, session.nextOffset);
  };

  return (
    <Paper
      ref={paperRef}
      data-testid="chat-floor-rail"
      data-collapsed={collapsed ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      variant="outlined"
      sx={{
        width: collapsed ? 46 : 280,
        maxHeight: collapsed ? 44 : "min(52vh, 420px)",
        overflow: "hidden",
        borderRadius: 1,
        bgcolor: "background.paper",
        boxShadow: (theme) => theme.customShadows?.z4,
        transform: `translateY(${verticalOffset}px)`,
        transition: dragging ? "none" : "width 140ms ease, max-height 140ms ease, background-color 140ms ease",
        willChange: dragging ? "transform" : "auto"
      }}
    >
      <Stack spacing={0.25} sx={{ p: 0.5 }}>
        <Stack
          direction="row"
          spacing={collapsed ? 0 : 0.5}
          alignItems="center"
          data-testid="chat-floor-drag-handle"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          sx={{
            px: collapsed ? 0 : 0.25,
            minHeight: 32,
            cursor: dragging ? "grabbing" : "grab",
            userSelect: "none",
            touchAction: "none"
          }}
        >
          <DragIndicatorIcon
            data-testid="chat-floor-collapsed-drag-grip"
            sx={{
              width: collapsed ? 10 : 16,
              fontSize: collapsed ? 12 : 16,
              color: "text.disabled",
              flexShrink: 0
            }}
          />
          {!collapsed && <FormatListBulletedIcon sx={{ fontSize: 17, color: "text.secondary", flexShrink: 0 }} />}
          {!collapsed && (
            <Typography variant="caption" sx={{ flex: 1, minWidth: 0, fontWeight: 850, whiteSpace: "nowrap", color: "text.secondary" }}>
              Prompts
            </Typography>
          )}
          <Tooltip title={collapsed ? "Expand prompts" : "Minimize prompts"}>
            <IconButton
              size="small"
              aria-label={collapsed ? "Expand prompts" : "Minimize prompts"}
              data-testid="chat-floor-collapse-toggle"
              onClick={toggleCollapsed}
              sx={{ width: collapsed ? 28 : 26, height: collapsed ? 28 : 26, ml: 0, flexShrink: 0 }}
            >
              {collapsed ? <FormatListBulletedIcon sx={{ fontSize: 17 }} /> : <KeyboardArrowRightIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
        {!collapsed && (
          <Box
            ref={scrollRef}
            data-testid="chat-floor-scroll"
            onPointerDown={() => {
              suppressAutoFollowUntilRef.current = performance.now() + 1_200;
            }}
            sx={{
              height: "calc(min(52vh, 420px) - 40px)",
              overflowY: "auto",
              overflowX: "hidden",
              pr: 0.25,
              contain: "strict"
            }}
          >
            <Box sx={{ position: "relative", height: virtualizer.getTotalSize(), width: "100%" }}>
              {virtualizer.getVirtualItems().map((virtualFloor) => {
                const floor = floors[virtualFloor.index];
                if (!floor) {
                  return null;
                }
                const active = floor.index === activeFloorIndex;
                return (
                  <Box
                    key={`${floor.index}-${floor.rowIndex}`}
                    sx={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualFloor.size,
                      transform: `translateY(${virtualFloor.start}px)`
                    }}
                  >
                    <ButtonBase
                      aria-label={`Jump to prompt ${floor.index}: ${floor.label}`}
                      title={`Prompt ${floor.index}: ${floor.label}`}
                      onClick={() => {
                        suppressAutoFollowUntilRef.current = performance.now() + 1_200;
                        onJump(floor.rowIndex);
                      }}
                      sx={{
                        width: "100%",
                        minHeight: 26,
                        borderRadius: 0.75,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-start",
                        gap: 0.75,
                        px: 0.5,
                        color: active ? "primary.main" : "text.secondary",
                        bgcolor: active ? (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.18 : 0.1) : "transparent",
                        "&:hover": { bgcolor: "action.hover" }
                      }}
                    >
                      <Box
                        aria-hidden
                        sx={{
                          width: active ? 12 : 8,
                          height: active ? 12 : 8,
                          borderRadius: 999,
                          border: "1px solid",
                          borderColor: active ? "primary.main" : "divider",
                          bgcolor: active ? "primary.main" : "background.paper",
                          flexShrink: 0
                        }}
                      />
                      <Typography
                        variant="caption"
                        sx={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textAlign: "left"
                        }}
                      >
                        {floor.index}. {floor.label}
                      </Typography>
                    </ButtonBase>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </Stack>
    </Paper>
  );
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function readStoredNumber(key: string, fallback: number): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function storeBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function storeNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}
