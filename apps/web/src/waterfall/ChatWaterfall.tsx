import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import KeyboardDoubleArrowDownIcon from "@mui/icons-material/KeyboardDoubleArrowDown";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type { TranslateFn } from "../i18n";
import { ChatRow } from "./ChatRow";
import { ChatFloorRail, type ChatFloorEntry } from "./ChatFloorRail";
import { ChatSearchOverlay, buildChatSearchResults, type ChatSearchScope } from "./ChatSearchOverlay";
import { estimateChatRowSize } from "./chatRowEstimates";
import { captureVisibleVirtualRowAnchor, remeasureMountedVirtualRows, restoreVirtualRowAnchor } from "./virtualRowMeasurements";
import { WaterfallRowRefreshQueue } from "./waterfallRowRefreshQueue";
import type { AssistantUsageDisplayMode, ChatWaterfallRow } from "./types";
import type { ChatTypographyPreference } from "../chatTypography";
import type { WebPreviewMode, WebPreviewState } from "../webPreview";

export const CHAT_ROW_FLASH_ANIMATION = "chatRowFlash 1400ms ease";
export const CHAT_ROW_FLASH_KEYFRAMES = {
  "0%": { boxShadow: (theme: { palette: { primary: { main: string } } }) => `0 0 0 0 ${alpha(theme.palette.primary.main, 0.32)}` },
  "38%": { boxShadow: (theme: { palette: { primary: { main: string } } }) => `0 0 0 6px ${alpha(theme.palette.primary.main, 0.18)}` },
  "100%": { boxShadow: (theme: { palette: { primary: { main: string } } }) => `0 0 0 0 ${alpha(theme.palette.primary.main, 0)}` }
};

type Props = {
  rows: ChatWaterfallRow[];
  t: TranslateFn;
  before?: ReactNode;
  assistantUsageDisplay?: AssistantUsageDisplayMode;
  onOpenPreview?: (url: string, mode: WebPreviewMode) => void;
  webPreview?: WebPreviewState | null;
  onClosePreview?: () => void;
  onEditUserMessage?: (row: ChatWaterfallRow, text: string) => void | Promise<void>;
  onDeletePendingMessage?: (id: string) => boolean;
  onOpenCommandBlacklistSettings?: (providerId?: string, groupId?: string) => void;
  onScrollActivity?: () => void;
  onScrollPositionChange?: (scrollTop: number) => void;
  sessionToken?: string | null;
  resetKey?: string;
  typography?: ChatTypographyPreference;
  onReachTop?: () => void | Promise<void>;
  loadingOlder?: boolean;
  hasOlder?: boolean;
  initialScrollTop?: number;
  interactive?: boolean;
  variant?: "workbench" | "official";
  onUndoFileChanges?: (rows: ChatWaterfallRow[]) => void;
  onReviewFileChanges?: (rows: ChatWaterfallRow[]) => void;
  mobileLayout?: boolean;
};

export function ChatWaterfall({ rows: incomingRows, t, before, assistantUsageDisplay = "summary", onOpenPreview, webPreview, onClosePreview, onEditUserMessage, onDeletePendingMessage, onOpenCommandBlacklistSettings, onScrollActivity, onScrollPositionChange, sessionToken, resetKey = "default", typography, onReachTop, loadingOlder = false, hasOlder = false, initialScrollTop, interactive = true, variant = "workbench", onUndoFileChanges, onReviewFileChanges, mobileLayout = false }: Props) {
  const [rows, setRows] = useState(incomingRows);
  const rowRefreshQueueRef = useRef(new WaterfallRowRefreshQueue(incomingRows));
  const initialRowsRef = useRef(incomingRows);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const parentRef = useRef<HTMLDivElement | null>(null);
  const onScrollPositionChangeRef = useRef(onScrollPositionChange);
  onScrollPositionChangeRef.current = onScrollPositionChange;
  const previousRowCountRef = useRef(rows.length);
  const resetKeyRef = useRef(resetKey);
  const jumpToLatestRef = useRef<() => void>(() => undefined);
  const pendingScrollFrameRef = useRef(0);
  const pendingFinalScrollFrameRef = useRef(0);
  const pendingScrollSampleFrameRef = useRef(0);
  const pendingRestoreFrameRef = useRef(0);
  const pendingResizeMeasureTimerRef = useRef(0);
  const pendingResizeScrollFrameRef = useRef(0);
  const pendingRowRefreshTimerRef = useRef<number | null>(null);
  const measuredContainerWidthRef = useRef(0);
  const jumpToLatestInProgressRef = useRef(false);
  const copiedFeedbackTimerRef = useRef(0);
  const flashFeedbackTimerRef = useRef(0);
  const nearBottomRef = useRef(true);
  const topLoadRequestedRef = useRef(false);
  const prependAnchorRef = useRef<{ totalSize: number; scrollTop: number } | null>(null);
  const previousScrollTopRef = useRef(0);
  const [nearBottom, setNearBottom] = useState(true);
  const [newRowsCount, setNewRowsCount] = useState(0);
  const [flashRowKey, setFlashRowKey] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchScope, setSearchScope] = useState<ChatSearchScope>("all");
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [copiedRowKey, setCopiedRowKey] = useState<string | null>(null);
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(() => new Set());

  const flushRowRefreshQueue = useCallback(() => {
    if (pendingRowRefreshTimerRef.current !== null) {
      window.clearTimeout(pendingRowRefreshTimerRef.current);
      pendingRowRefreshTimerRef.current = null;
    }
    const nextRows = rowRefreshQueueRef.current.beginFlush();
    if (!nextRows) {
      return;
    }
    setRows(nextRows);
  }, []);

  const scheduleRowRefreshQueue = useCallback(() => {
    if (pendingRowRefreshTimerRef.current !== null || !rowRefreshQueueRef.current.hasPending()) {
      return;
    }
    pendingRowRefreshTimerRef.current = window.setTimeout(() => {
      pendingRowRefreshTimerRef.current = null;
      flushRowRefreshQueue();
    }, 0);
  }, [flushRowRefreshQueue]);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      rowRefreshQueueRef.current.reset(incomingRows);
      setRows(incomingRows);
      return;
    }
    if (rowRefreshQueueRef.current.enqueue(incomingRows)) {
      scheduleRowRefreshQueue();
    }
  }, [incomingRows, resetKey, scheduleRowRefreshQueue]);

  useLayoutEffect(() => {
    rowRefreshQueueRef.current.markApplied(rows);
    if (rowRefreshQueueRef.current.hasPending()) {
      scheduleRowRefreshQueue();
    }
  }, [rows, scheduleRowRefreshQueue]);

  useEffect(() => () => {
    if (pendingRowRefreshTimerRef.current !== null) {
      window.clearTimeout(pendingRowRefreshTimerRef.current);
      pendingRowRefreshTimerRef.current = null;
    }
    rowRefreshQueueRef.current.reset(initialRowsRef.current);
  }, []);
  const beforeOffset = before ? 1 : 0;
  const virtualCount = rows.length + beforeOffset;
  const initialScrollOffset = useMemo(
    () => initialScrollTop ?? (before ? 220 : 0) + rows.reduce((total, row) => total + estimateChatRowSize(row, false, typography), 0),
    [before, initialScrollTop, resetKey, typography?.fontSize, typography?.lineHeight, typography?.messageSpacing]
  );
  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => (before && index === 0 ? "chat-waterfall-before" : rows[index - beforeOffset]?.key ?? index),
    estimateSize: (index) => {
      if (before && index === 0) {
        return 220;
      }
      const row = rows[index - beforeOffset];
      return row ? estimateChatRowSize(row, false, typography) : 120;
    },
    overscan: 3,
    initialOffset: () => initialScrollOffset
  });
  const virtualRows = virtualizer.getVirtualItems();
  const firstVisibleVirtualIndex =
    virtualRows.find((virtualRow) => virtualRow.index >= beforeOffset && virtualRow.end > (parentRef.current?.scrollTop ?? 0))?.index ?? beforeOffset;
  const firstVisibleRowIndex = Math.max(0, firstVisibleVirtualIndex - beforeOffset);
  const jumpToRow = useCallback((rowIndex: number, align: "start" | "center" = "start") => {
    const row = rows[rowIndex];
    if (!row) {
      return;
    }
    window.cancelAnimationFrame(pendingScrollFrameRef.current);
    window.cancelAnimationFrame(pendingFinalScrollFrameRef.current);
    pendingScrollFrameRef.current = 0;
    pendingFinalScrollFrameRef.current = 0;
    jumpToLatestInProgressRef.current = false;
    nearBottomRef.current = false;
    setNearBottom(false);
    markNavigation("prompt", rowIndex);
    virtualizer.scrollToIndex(rowIndex + beforeOffset, { align });
    window.clearTimeout(flashFeedbackTimerRef.current);
    setFlashRowKey(row.key);
    flashFeedbackTimerRef.current = window.setTimeout(
      () => setFlashRowKey((current) => (current === row.key ? null : current)),
      1400
    );
  }, [beforeOffset, rows, virtualizer]);
  const floors = useMemo<ChatFloorEntry[]>(() =>
    rows
      .map((row, rowIndex) =>
        row.floor
          ? {
              rowIndex,
              index: row.floor.index,
              label: row.floor.label
            }
          : null
      )
      .filter((entry): entry is ChatFloorEntry => Boolean(entry)),
    [rows]
  );
  const activeFloorIndex = useMemo(() => activeFloorAtRow(floors, firstVisibleRowIndex), [firstVisibleRowIndex, floors]);
  const searchResults = useMemo(
    () => searchOpen ? buildChatSearchResults(rows, searchTerm, searchScope) : [],
    [rows, searchOpen, searchScope, searchTerm]
  );
  const latestActivityKey = useMemo(() => {
    const latest = rows.at(-1);
    if (!latest) {
      return `${rows.length}:empty`;
    }
    return [
      rows.length,
      latest.key,
      latest.status ?? ""
    ].join(":");
  }, [rows]);
  const rowKeySignature = `${rows.length}:${rows[0]?.key ?? ""}:${rows.at(-1)?.key ?? ""}`;
  const updateNearBottom = useCallback((allowOlderLoad = false) => {
    const element = parentRef.current;
    if (!element) {
      return;
    }
    if (jumpToLatestInProgressRef.current) {
      nearBottomRef.current = true;
      setNearBottom(true);
      setNewRowsCount(0);
      return;
    }
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    scrollPositionsRef.current.set(resetKeyRef.current, element.scrollTop);
    onScrollPositionChangeRef.current?.(element.scrollTop);
    const scrollingUp = element.scrollTop < previousScrollTopRef.current;
    previousScrollTopRef.current = element.scrollTop;
    const nextNearBottom = distanceFromBottom < 180;
    if (nearBottomRef.current !== nextNearBottom) {
      nearBottomRef.current = nextNearBottom;
      setNearBottom(nextNearBottom);
    }
    if (nextNearBottom) {
      setNewRowsCount(0);
    }
    if (allowOlderLoad && scrollingUp && element.scrollTop < 240 && hasOlder && !loadingOlder && !topLoadRequestedRef.current && onReachTop) {
      prependAnchorRef.current = { totalSize: virtualizer.getTotalSize(), scrollTop: element.scrollTop };
      topLoadRequestedRef.current = true;
      void Promise.resolve(onReachTop()).finally(() => {
        topLoadRequestedRef.current = false;
      });
    }
  }, [hasOlder, loadingOlder, onReachTop, virtualizer]);

  useEffect(() => {
    const element = parentRef.current;
    if (!element || !interactive) {
      return;
    }
    updateNearBottom(false);
    const onScroll = () => {
      onScrollActivity?.();
      if (pendingScrollSampleFrameRef.current) return;
      pendingScrollSampleFrameRef.current = window.requestAnimationFrame(() => {
        pendingScrollSampleFrameRef.current = 0;
        updateNearBottom(true);
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(pendingScrollSampleFrameRef.current);
      pendingScrollSampleFrameRef.current = 0;
    };
  }, [interactive, onScrollActivity, updateNearBottom]);

  useEffect(() => () => {
    const element = parentRef.current;
    if (element) onScrollPositionChangeRef.current?.(element.scrollTop);
    window.cancelAnimationFrame(pendingScrollFrameRef.current);
    window.cancelAnimationFrame(pendingFinalScrollFrameRef.current);
    window.cancelAnimationFrame(pendingScrollSampleFrameRef.current);
    window.cancelAnimationFrame(pendingRestoreFrameRef.current);
    window.clearTimeout(pendingResizeMeasureTimerRef.current);
    window.cancelAnimationFrame(pendingResizeScrollFrameRef.current);
    window.clearTimeout(copiedFeedbackTimerRef.current);
    window.clearTimeout(flashFeedbackTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const element = parentRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    measuredContainerWidthRef.current = Math.round(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry?.contentRect.width ?? element.clientWidth);
      if (width <= 0 || width === measuredContainerWidthRef.current) return;
      measuredContainerWidthRef.current = width;
      window.clearTimeout(pendingResizeMeasureTimerRef.current);
      window.cancelAnimationFrame(pendingResizeScrollFrameRef.current);
      // Collapse the ResizeObserver burst produced while dragging a divider.
      // One measurement after the pane settles avoids a full virtual-list scan
      // on every pointer frame.
      pendingResizeMeasureTimerRef.current = window.setTimeout(() => {
        pendingResizeMeasureTimerRef.current = 0;
        const keepLatestVisible = nearBottomRef.current;
        const anchor = keepLatestVisible ? null : captureVisibleVirtualRowAnchor(element);
        // Split creation, pane resizing and maximize/restore all change text
        // wrapping. Keep measurements for off-screen rows and replace only
        // the mounted rows with their current DOM heights. A global measure()
        // clears every real size and can leave already-mounted rows stuck on
        // narrow-pane estimates after their ResizeObserver event has fired.
        remeasureMountedVirtualRows(element, (index, height) => virtualizer.resizeItem(index, height));
        const restoreScrollPosition = () => {
          pendingResizeScrollFrameRef.current = 0;
          const current = parentRef.current;
          if (!current) return;
          if (keepLatestVisible) {
            current.scrollTop = current.scrollHeight;
            updateNearBottom(false);
          } else {
            restoreVirtualRowAnchor(current, anchor);
          }
        };
        pendingResizeScrollFrameRef.current = window.requestAnimationFrame(() => {
          restoreScrollPosition();
          pendingResizeScrollFrameRef.current = window.requestAnimationFrame(restoreScrollPosition);
        });
      }, 48);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(pendingResizeMeasureTimerRef.current);
      window.cancelAnimationFrame(pendingResizeScrollFrameRef.current);
      pendingResizeMeasureTimerRef.current = 0;
      pendingResizeScrollFrameRef.current = 0;
    };
  }, [updateNearBottom, virtualizer]);

  useEffect(() => {
    const previousCount = previousRowCountRef.current;
    if (rows.length > previousCount && !nearBottom) {
      setNewRowsCount((current) => current + rows.length - previousCount);
    }
    previousRowCountRef.current = rows.length;
  }, [nearBottom, rows.length]);

  const toggleRowCallbacksRef = useRef<Map<string, () => void>>(new Map());
  useEffect(() => {
    const rowKeys = new Set(rows.map((row) => row.key));
    setCopiedRowKey((current) => current && rowKeys.has(current) ? current : null);
    setExpandedRowKeys((current) => {
      const next = new Set([...current].filter((key) => rowKeys.has(key)));
      return next.size === current.size ? current : next;
    });
    for (const key of toggleRowCallbacksRef.current.keys()) {
      if (!rowKeys.has(key)) toggleRowCallbacksRef.current.delete(key);
    }
  }, [rowKeySignature]);

  const toggleRowExpanded = useCallback((rowKey: string) => {
    setExpandedRowKeys((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  const getToggleRowExpanded = useCallback((rowKey: string) => {
    let cb = toggleRowCallbacksRef.current.get(rowKey);
    if (!cb) {
      cb = () => toggleRowExpanded(rowKey);
      toggleRowCallbacksRef.current.set(rowKey, cb);
    }
    return cb;
  }, [toggleRowExpanded]);

  const editableUserRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.kind === "userMessage") counts.set(row.turnId, (counts.get(row.turnId) ?? 0) + 1);
    }
    const latest = [...rows].reverse().find((row) => row.kind === "userMessage" && (counts.get(row.turnId) ?? 0) === 1);
    return latest?.key ?? null;
  }, [rows]);

  useEffect(() => {
    if (editingRowKey && editingRowKey !== editableUserRows) {
      setEditingRowKey(null);
      setEditingText("");
      setEditSubmitting(false);
    }
  }, [editingRowKey, editableUserRows]);

  const beginEditUserMessage = useCallback((row: ChatWaterfallRow) => {
    if (!onEditUserMessage || row.kind !== "userMessage" || row.key !== editableUserRows || row.isLive) {
      return;
    }
    setEditingRowKey(row.key);
    setEditingText(row.item.images?.length
      ? row.text.split(/\r?\n/).filter((line) => line.trim().toLowerCase() !== "[image]").join("\n").trim()
      : row.text);
    setCopiedRowKey(null);
  }, [editableUserRows, onEditUserMessage]);

  const cancelEditUserMessage = useCallback(() => {
    if (editSubmitting) return;
    setEditingRowKey(null);
    setEditingText("");
  }, [editSubmitting]);

  const submitEditUserMessage = useCallback(async (row: ChatWaterfallRow) => {
    const text = editingText.trim();
    if (!onEditUserMessage || !text || editSubmitting) return;
    setEditSubmitting(true);
    try {
      await onEditUserMessage(row, text);
      setEditingRowKey(null);
      setEditingText("");
    } catch {
      // The parent reports the error and keeps the editor open for correction.
    } finally {
      setEditSubmitting(false);
    }
  }, [editSubmitting, editingText, onEditUserMessage]);

  const copyRow = useCallback(async (row: ChatWaterfallRow) => {
    const text = copyableRowText(row);
    if (!text) {
      return;
    }
    try {
      await writeClipboardText(text);
      window.clearTimeout(copiedFeedbackTimerRef.current);
      setCopiedRowKey(row.key);
      copiedFeedbackTimerRef.current = window.setTimeout(() => setCopiedRowKey((current) => current === row.key ? null : current), 1_600);
    } catch {
      // Keep the copy icon unchanged when clipboard access is unavailable.
    }
  }, []);

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [searchScope, searchTerm]);

  useLayoutEffect(() => {
    if (!interactive) return;
    if (resetKeyRef.current === resetKey) {
      return;
    }
    const previousKey = resetKeyRef.current;
    const previousElement = parentRef.current;
    if (previousElement) scrollPositionsRef.current.set(previousKey, previousElement.scrollTop);
    resetKeyRef.current = resetKey;
    previousScrollTopRef.current = 0;
    nearBottomRef.current = true;
    setNearBottom(true);
    setNewRowsCount(0);
    setFlashRowKey(null);
    setSearchOpen(false);
    setSearchTerm("");
    setSelectedSearchIndex(0);
    setExpandedRowKeys(new Set());
    window.cancelAnimationFrame(pendingRestoreFrameRef.current);
    pendingRestoreFrameRef.current = window.requestAnimationFrame(() => {
      pendingRestoreFrameRef.current = 0;
      // Measure after paint: doing this synchronously in the layout effect
      // forces a full-list layout inside the tab-switch commit and collides
      // with the composer autosize read, producing the multi-frame jank.
      virtualizer.measure();
      const element = parentRef.current;
      const savedPosition = scrollPositionsRef.current.get(resetKey);
      if (element && savedPosition != null) {
        element.scrollTop = Math.min(savedPosition, Math.max(0, element.scrollHeight - element.clientHeight));
        previousScrollTopRef.current = element.scrollTop;
        updateNearBottom(false);
      } else {
        scrollToBottom(true);
      }
    });
  }, [interactive, resetKey, updateNearBottom, virtualizer]);

  useLayoutEffect(() => {
    if (!interactive) return;
    virtualizer.measure();
  }, [interactive, typography?.fontSize, typography?.lineHeight, typography?.messageSpacing, virtualizer]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const element = parentRef.current;
    if (!anchor || !element) return;
    virtualizer.measure();
    element.scrollTop = Math.max(0, anchor.scrollTop + virtualizer.getTotalSize() - anchor.totalSize);
    prependAnchorRef.current = null;
  }, [rows.length, virtualizer]);

  useEffect(() => {
    if (!interactive) return;
    if (!searchOpen || searchResults.length === 0) {
      return;
    }
    const safeIndex = Math.min(selectedSearchIndex, searchResults.length - 1);
    const result = searchResults[safeIndex];
    if (result) {
      // Center search results so the sticky search controls do not cover the
      // matched row or intercept clicks on its expand/collapse actions.
      jumpToRow(result.rowIndex, "center");
    }
  }, [interactive, searchOpen, searchResults, selectedSearchIndex]);

  useEffect(() => {
    if (!interactive) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "ArrowDown" || event.key === "End")) {
        event.preventDefault();
        jumpToLatestRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [interactive]);

  useLayoutEffect(() => {
    if (!interactive) return;
    if (!nearBottomRef.current || rows.length === 0 || searchOpen) {
      return;
    }
    scrollToBottom();
    setNewRowsCount(0);
  }, [interactive, latestActivityKey, searchOpen]);

  function jumpToLatest() {
    if (rows.length === 0) {
      return;
    }
    markNavigation("latest", rows.length - 1);
    jumpToLatestInProgressRef.current = true;
    window.cancelAnimationFrame(pendingScrollFrameRef.current);
    window.cancelAnimationFrame(pendingFinalScrollFrameRef.current);
    pendingScrollFrameRef.current = 0;
    pendingFinalScrollFrameRef.current = 0;
    scrollToBottom(true);
    setNearBottom(true);
    setNewRowsCount(0);
  }

  function selectSearchIndex(index: number) {
    if (searchResults.length === 0) {
      setSelectedSearchIndex(0);
      return;
    }
    setSelectedSearchIndex((index + searchResults.length) % searchResults.length);
  }

  jumpToLatestRef.current = jumpToLatest;

  function markNavigation(action: "prompt" | "latest", rowIndex: number) {
    const element = parentRef.current;
    if (!element) {
      return;
    }
    element.dataset.lastNavigationAction = action;
    element.dataset.lastNavigationRowIndex = String(rowIndex);
    element.dataset.lastNavigationAt = new Date().toISOString();
  }

  function scrollToBottom(useVirtualizer = false) {
    if (virtualCount <= 0 || pendingScrollFrameRef.current || pendingFinalScrollFrameRef.current) {
      return;
    }
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }
    nearBottomRef.current = true;
    pendingScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingScrollFrameRef.current = 0;
      const element = parentRef.current;
      if (!element) {
        jumpToLatestInProgressRef.current = false;
        return;
      }
      if (useVirtualizer) {
        virtualizer.scrollToIndex(virtualCount - 1, { align: "end" });
      }
      // P4 single-pass scroll: one read + one write. A second settle pass runs
      // only when late-measured streaming rows grew the container afterwards.
      element.scrollTop = element.scrollHeight;
      const settled = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
      if (settled) {
        jumpToLatestInProgressRef.current = false;
        updateNearBottom();
        return;
      }
      pendingFinalScrollFrameRef.current = window.requestAnimationFrame(() => {
        pendingFinalScrollFrameRef.current = 0;
        const currentElement = parentRef.current;
        if (currentElement) currentElement.scrollTop = currentElement.scrollHeight;
        jumpToLatestInProgressRef.current = false;
        updateNearBottom();
      });
    });
  }

  if (rows.length === 0 && before) {
    return (
    <Box
      ref={parentRef}
      data-testid="chat-waterfall-scroll"
      data-virtual-page-key={resetKey}
      className={variant === "official" ? "thread-scroll-container chatgpt-conversation" : undefined}
      sx={{
        position: "relative",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
          overflowY: "auto",
          overflowX: "hidden",
          p: variant === "official" ? 0 : { xs: 1, sm: 1.5 },
          pb: "calc(var(--immersive-composer-space, 0px) + 12px)"
        }}
      >
        <Box sx={{ width: "100%", maxWidth: "min(100%, 1180px)", my: "auto" }}>
          {before}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      ref={parentRef}
      data-testid="chat-waterfall-scroll"
      data-virtual-page-key={resetKey}
      className={variant === "official" ? "thread-scroll-container chatgpt-conversation" : undefined}
      sx={{
        position: "relative",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        height: "100%",
        maxHeight: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        p: variant === "official" ? 0 : { xs: 1, sm: 2.5, lg: 3 },
        pb: "calc(var(--immersive-composer-space, 0px) + 24px)",
        scrollPaddingBottom: "var(--immersive-composer-space, 0px)"
      }}
    >
      {variant !== "official" && floors.length > 1 && (
        <Box
          sx={{
            position: "sticky",
            top: 12,
            zIndex: 4,
            height: 0,
            display: { xs: "none", lg: "flex" },
            justifyContent: "flex-end",
            pointerEvents: "none",
            pr: 0.5
          }}
        >
          <Box sx={{ pointerEvents: "auto" }}>
            <ChatFloorRail floors={floors} activeFloorIndex={activeFloorIndex} onJump={jumpToRow} />
          </Box>
        </Box>
      )}
      {variant !== "official" && (
        <Box
          sx={{
            position: "sticky",
            top: 8,
            zIndex: 5,
            height: 0,
            display: "flex",
            justifyContent: { xs: "flex-end", sm: "center" },
            pointerEvents: "none",
            pr: { xs: 0.5, sm: 0 }
          }}
        >
          <Box sx={{ pointerEvents: "auto" }}>
            <ChatSearchOverlay
              open={searchOpen}
              rows={rows}
              term={searchTerm}
              scope={searchScope}
              selectedIndex={Math.min(selectedSearchIndex, Math.max(0, searchResults.length - 1))}
              results={searchResults}
              onOpen={() => {
                setSearchOpen(true);
              }}
              onClose={() => setSearchOpen(false)}
              onTermChange={setSearchTerm}
              onScopeChange={setSearchScope}
              onSelectIndex={selectSearchIndex}
            />
          </Box>
        </Box>
      )}
      <Box
        className={variant === "official" ? "chatgpt-waterfall-content" : undefined}
        sx={{ width: "100%", minWidth: 0, maxWidth: variant === "official" ? "min(100%, var(--thread-content-max-width))" : "min(100%, 1600px)", mx: "auto", boxSizing: "border-box" }}
      >
        {loadingOlder && (
          <Box data-testid="loading-older-history" sx={{ position: "sticky", top: 8, zIndex: 5, height: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
            <Chip size="small" variant="outlined" label="Loading older history…" />
          </Box>
        )}
        <Box
          data-testid="conversation-waterfall"
          data-virtual-page-key={resetKey}
          data-row-count={rows.length}
          data-pinned-live-row-count="0"
          sx={{
            position: "relative",
            width: "100%",
            height: virtualizer.getTotalSize(),
            mt: before ? 1 : 0
          }}
        >
          {virtualRows.map((virtualRow) => {
            if (before && virtualRow.index === 0) {
              return (
                <MeasuredVirtualRow
                  key="chat-waterfall-before"
                  virtualizer={virtualizer}
                  data-index={virtualRow.index}
                  data-chat-virtual-row="true"
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                    pb: 1.75
                  }}
                >
                  {before}
                </MeasuredVirtualRow>
              );
            }
            const row = rows[virtualRow.index - beforeOffset];
            if (!row) {
              return null;
            }
            return (
              <MeasuredVirtualRow
                key={row.key}
                virtualizer={virtualizer}
                data-index={virtualRow.index}
                data-chat-virtual-row="true"
                data-chat-row-key={row.key}
                data-chat-row-kind={row.kind}
                data-chat-row-expanded={expandedRowKeys.has(row.key) ? "true" : "false"}
                data-thread-find-target={variant === "official" ? "conversation" : undefined}
                data-testid={`conversation-item-${sanitizeTestId(row.item.id)}`}
                className={variant === "official" ? "chatgpt-writing-block" : undefined}
                sx={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  boxSizing: "border-box",
                  pr: variant === "official" ? 0 : row.role === "user" ? (mobileLayout ? 1 : 4) : 0,
                  pl: variant === "official" ? 0 : row.role === "user" ? 0 : (mobileLayout ? 1 : 4),
                  transform: `translateY(${virtualRow.start}px)`,
                  pb: variant === "official" ? "0.75rem" : (mobileLayout ? "4px" : "var(--chat-message-spacing, 6px)"),
                  borderRadius: 1,
                  animation: flashRowKey === row.key ? CHAT_ROW_FLASH_ANIMATION : "none",
                  "&:hover .conversation-copy-action, &:focus-within .conversation-copy-action": { opacity: 1, pointerEvents: "auto", transform: "translateY(0)" },
                  "@keyframes chatRowFlash": CHAT_ROW_FLASH_KEYFRAMES
                }}
              >
                <ChatRow
                  row={row}
                  t={t}
                  expanded={expandedRowKeys.has(row.key)}
                  onToggleExpanded={getToggleRowExpanded(row.key)}
                  assistantUsageDisplay={assistantUsageDisplay}
                  onOpenPreview={onOpenPreview}
                  webPreview={webPreview}
                  onClosePreview={onClosePreview}
                  sessionToken={sessionToken}
                  editing={editingRowKey === row.key}
                  editText={editingText}
                  editSubmitting={editSubmitting}
                  onEditTextChange={setEditingText}
                  onEditSubmit={() => void submitEditUserMessage(row)}
                  onEditCancel={cancelEditUserMessage}
                  onOpenCommandBlacklistSettings={onOpenCommandBlacklistSettings}
                  variant={variant}
                  onUndoFileChanges={row.kind === "fileChangeGroup" ? onUndoFileChanges : undefined}
                  onReviewFileChanges={row.kind === "fileChangeGroup" ? onReviewFileChanges : undefined}
                />
                {variant !== "official" && (
                  <Box className="conversation-copy-action"
                    sx={{
                      position: "absolute",
                      right: row.role === "user" ? 4 : "auto",
                      left: row.role === "user" ? "auto" : 4,
                      top: 4,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      px: { xs: 0.25, sm: 0.5 },
                      opacity: copiedRowKey === row.key || editingRowKey === row.key ? 1 : 0,
                      pointerEvents: copiedRowKey === row.key || editingRowKey === row.key || row.item.type === "pendingAppend" || (row.kind === "userMessage" && row.key === editableUserRows && Boolean(onEditUserMessage)) ? "auto" : "none",
                      transform: "translateY(3px)",
                      transition: "opacity 120ms ease, transform 120ms ease",
                      zIndex: 2
                    }}
                  >
                  <Tooltip title={copiedRowKey === row.key ? "Copied" : "Copy message"}>
                    <IconButton
                      size="small"
                      aria-label={copiedRowKey === row.key ? "Message copied" : "Copy message"}
                      data-testid={`copy-conversation-item-${sanitizeTestId(row.item.id)}`}
                      data-copied={copiedRowKey === row.key ? "true" : "false"}
                      onClick={() => void copyRow(row)}
                      sx={{
                        width: 24,
                        height: 24,
                        color: copiedRowKey === row.key ? "success.main" : "text.disabled",
                        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92),
                        border: "1px solid",
                        borderColor: "divider",
                        boxShadow: 1,
                        transition: "color 140ms ease, background-color 140ms ease",
                        "&:hover": {
                          color: copiedRowKey === row.key ? "success.main" : "text.secondary",
                          bgcolor: copiedRowKey === row.key ? (theme) => alpha(theme.palette.success.main, 0.1) : "action.hover"
                        }
                      }}
                    >
                      {copiedRowKey === row.key
                        ? <CheckRoundedIcon data-testid="conversation-copy-success" sx={{ fontSize: 17 }} />
                        : <ContentCopyIcon sx={{ fontSize: 16 }} />}
                    </IconButton>
                  </Tooltip>
                  {row.item.type === "pendingAppend" && onDeletePendingMessage && (
                    <Tooltip title="Delete waiting message">
                      <IconButton
                        size="small"
                        aria-label="Delete waiting message"
                        data-testid={`delete-pending-message-${sanitizeTestId(row.item.id)}`}
                        onClick={() => onDeletePendingMessage(row.item.id)}
                        sx={{
                          width: 24, height: 24, mt: 0.5, color: "text.disabled",
                          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92),
                          border: "1px solid", borderColor: "divider", boxShadow: 1,
                          "&:hover": { color: "error.main", bgcolor: (theme) => alpha(theme.palette.error.main, 0.08) }
                        }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {row.kind === "userMessage" && row.key === editableUserRows && onEditUserMessage && (
                    <Tooltip title="Edit last message">
                      <IconButton
                        size="small"
                        aria-label="Edit last message"
                        data-testid={`edit-conversation-item-${sanitizeTestId(row.item.id)}`}
                        disabled={editSubmitting}
                        onClick={() => beginEditUserMessage(row)}
                        sx={{
                          width: 24,
                          height: 24,
                          mt: 0.5,
                          color: "text.disabled",
                          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92),
                          border: "1px solid",
                          borderColor: "divider",
                          boxShadow: 1,
                          "&:hover": { color: "text.secondary", bgcolor: "action.hover" }
                        }}
                      >
                        <EditOutlinedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  </Box>
                )}
              </MeasuredVirtualRow>
            );
          })}
        </Box>
      </Box>
      {!nearBottom && rows.length > 0 && (
        <Box
          sx={{
            position: "sticky",
            bottom: 12,
            display: "flex",
            justifyContent: { xs: "flex-end", sm: "center" },
            pointerEvents: "none",
            zIndex: 2,
            pr: { xs: 1, sm: 0 }
          }}
        >
          <Stack spacing={0.75} alignItems="center" sx={{ pointerEvents: "auto" }}>
            <Button
              className={variant === "official" ? "chatgpt-jump-latest" : undefined}
              size="small"
              variant="contained"
              startIcon={<KeyboardDoubleArrowDownIcon />}
              onClick={jumpToLatest}
              sx={{ borderRadius: 999, boxShadow: (theme) => theme.customShadows?.z8 }}
            >
              Jump to latest
              {newRowsCount > 0 && <Chip size="small" label={newRowsCount} sx={{ ml: 1, height: 20, bgcolor: "primary.contrastText" }} />}
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

function copyableRowText(row: ChatWaterfallRow): string {
  if (row.kind === "commandGroup" || row.kind === "fileChangeGroup") {
    return (row.groupedRows ?? []).map(copyableRowText).filter(Boolean).join("\n\n") || row.title.trim();
  }
  if (row.kind === "imageGeneration") {
    const revisedPrompt = row.item.images?.[0]?.revisedPrompt?.trim();
    if (revisedPrompt) {
      return revisedPrompt;
    }
  }
  const text = row.text.trimEnd() || row.item.text.trimEnd();
  if (text) {
    return text;
  }
  const payload = row.item.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const key of ["path", "filePath", "command", "query", "name"] as const) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return row.title.trim();
}

async function writeClipboardText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall through to the legacy copy path for restricted browser contexts.
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

function MeasuredVirtualRow({
  virtualizer,
  children,
  sx,
  ...props
}: {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  children: ReactNode;
} & ComponentProps<typeof Box>) {
  return (
    <Box
      ref={virtualizer.measureElement}
      {...props}
      sx={[
        { width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" },
        ...(Array.isArray(sx) ? sx : [sx])
      ]}
    >
      {children}
    </Box>
  );
}

function sanitizeTestId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-");
}

function activeFloorAtRow(floors: ChatFloorEntry[], rowIndex: number): number | null {
  if (floors.length === 0) {
    return null;
  }
  let low = 0;
  let high = floors.length - 1;
  let match = floors[0]?.index ?? null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const floor = floors[middle];
    if (!floor) {
      break;
    }
    if (floor.rowIndex <= rowIndex) {
      match = floor.index;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}
