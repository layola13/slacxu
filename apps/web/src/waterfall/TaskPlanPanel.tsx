import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, CircularProgress, Collapse, IconButton, LinearProgress, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ChecklistIcon from "@mui/icons-material/Checklist";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import type { TranslateFn } from "../i18n";
import type { TaskPlan, TaskPlanStep } from "./taskPlan";

type Props = {
  plan: TaskPlan | null;
  t: TranslateFn;
};

export function TaskPlanPanel({ plan, t }: Props) {
  const allCompleted = Boolean(plan && plan.steps.every((step) => step.status === "completed"));
  const [visible, setVisible] = useState(Boolean(plan && !allCompleted));
  const [expanded, setExpanded] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const previousRef = useRef({ sourceKey: plan?.sourceKey ?? null, completed: allCompleted });
  const completedCount = useMemo(() => plan?.steps.filter((step) => step.status === "completed").length ?? 0, [plan]);
  const progress = plan?.steps.length ? (completedCount / plan.steps.length) * 100 : 0;

  useEffect(() => {
    const previous = previousRef.current;
    let closeTimer: number | undefined;

    if (!plan) {
      setVisible(false);
      setFinishing(false);
    } else if (previous.sourceKey !== plan.sourceKey) {
      setExpanded(true);
      setFinishing(false);
      setVisible(!allCompleted);
      setDragOffset({ x: 0, y: 0 });
    } else if (!previous.completed && allCompleted) {
      setVisible(true);
      setFinishing(true);
      closeTimer = window.setTimeout(() => {
        setVisible(false);
        setFinishing(false);
      }, 950);
    } else if (previous.completed && !allCompleted) {
      setExpanded(true);
      setFinishing(false);
      setVisible(true);
    }

    previousRef.current = { sourceKey: plan?.sourceKey ?? null, completed: allCompleted };
    return () => {
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
      }
    };
  }, [allCompleted, plan?.sourceKey]);

  useEffect(() => {
    const cancelDrag = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const handle = overlayRef.current?.querySelector<HTMLElement>('[data-testid="task-plan-drag-handle"]');
      if (handle?.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
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
  }, []);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const overlay = overlayRef.current;
    const parent = overlay?.parentElement;
    if (!overlay || !parent) {
      return;
    }
    const overlayBounds = overlay.getBoundingClientRect();
    const parentBounds = parent.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
      minX: dragOffset.x + parentBounds.left - overlayBounds.left,
      maxX: dragOffset.x + parentBounds.right - overlayBounds.right,
      minY: dragOffset.y + parentBounds.top - overlayBounds.top,
      maxY: dragOffset.y + parentBounds.bottom - overlayBounds.bottom
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setDragOffset({
      x: clamp(drag.originX + event.clientX - drag.startX, drag.minX, drag.maxX),
      y: clamp(drag.originY + event.clientY - drag.startY, drag.minY, drag.maxY)
    });
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (!plan) {
    return null;
  }

  const toggleLabel = expanded ? t("chat.taskPlan.collapse") : t("chat.taskPlan.expand");
  return (
    <Box
      ref={overlayRef}
      data-testid="task-plan-overlay"
      sx={{
        position: "absolute",
        top: 12,
        left: { xs: 8, sm: 12 },
        zIndex: 7,
        width: { xs: "min(360px, calc(100% - 16px))", sm: "min(380px, calc(100% - 24px))" },
        pointerEvents: "none",
        transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`
      }}
    >
      <Collapse in={visible} timeout={320} unmountOnExit>
        <Paper
          variant="outlined"
          data-testid="task-plan-panel"
          aria-live="polite"
          data-completing={finishing ? "true" : "false"}
          sx={{
            overflow: "hidden",
            pointerEvents: "auto",
            borderRadius: 1,
            bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.94 : 0.97),
            borderColor: (theme) => alpha(finishing ? theme.palette.success.main : theme.palette.primary.main, finishing ? 0.55 : 0.28),
            boxShadow: (theme) => theme.customShadows?.z8,
            backdropFilter: "blur(18px)",
            animation: finishing ? "taskPlanComplete 900ms ease both" : "taskPlanEnter 240ms ease-out both",
            "@keyframes taskPlanEnter": {
              from: { opacity: 0, transform: "translateY(-8px) scale(0.985)" },
              to: { opacity: 1, transform: "translateY(0) scale(1)" }
            },
            "@keyframes taskPlanComplete": {
              "0%": { opacity: 1, transform: "translateY(0) scale(1)" },
              "42%": { opacity: 1, transform: "translateY(0) scale(1.015)" },
              "72%": { opacity: 0.92, transform: "translateY(-2px) scale(1)" },
              "100%": { opacity: 0, transform: "translateY(-10px) scale(0.98)" }
            }
          }}
        >
          <Stack
            component="div"
            direction="row"
            spacing={0.85}
            alignItems="center"
            data-testid="task-plan-drag-handle"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            sx={{
              width: "100%",
              minHeight: 42,
              px: 1,
              py: 0.65,
              border: 0,
              bgcolor: "transparent",
              color: "text.primary",
              textAlign: "left",
              cursor: dragging ? "grabbing" : "grab",
              font: "inherit",
              touchAction: "none",
              userSelect: "none",
              "&:hover": { bgcolor: "action.hover" }
            }}
          >
            <DragIndicatorIcon sx={{ fontSize: 17, color: "text.secondary", flex: "0 0 auto" }} />
            <ChecklistIcon sx={{ fontSize: 18, color: finishing ? "success.main" : "primary.main", flex: "0 0 auto" }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850, lineHeight: 1.2 }}>
                {t("chat.taskPlan.title")}
              </Typography>
              <Typography variant="caption" color={finishing ? "success.main" : "text.secondary"} sx={{ display: "block", fontWeight: 700 }}>
                {finishing
                  ? t("chat.taskPlan.completed")
                  : t("chat.taskPlan.progress", { completed: completedCount, total: plan.steps.length })}
              </Typography>
            </Box>
            <Tooltip title={toggleLabel}>
              <IconButton
                size="small"
                aria-expanded={expanded}
                aria-label={toggleLabel}
                data-testid="task-plan-toggle"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setExpanded((current) => !current)}
                sx={{ width: 28, height: 28, flex: "0 0 auto" }}
              >
                {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={progress}
            color={finishing ? "success" : "primary"}
            sx={{ height: 3, bgcolor: "action.hover" }}
          />
          <Collapse in={expanded} timeout={220}>
            <Stack
              data-testid="task-plan-steps"
              spacing={0.65}
              sx={{ px: 1.1, py: 1, maxHeight: "min(42vh, 360px)", overflowY: "auto", overscrollBehavior: "contain" }}
            >
              {plan.steps.map((step) => <TaskPlanStepRow key={step.id} step={step} />)}
            </Stack>
          </Collapse>
        </Paper>
      </Collapse>
    </Box>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max));
}

function TaskPlanStepRow({ step }: { step: TaskPlanStep }) {
  return (
    <Stack
      direction="row"
      spacing={0.8}
      alignItems="flex-start"
      data-status={step.status}
      sx={{
        minWidth: 0,
        color: step.status === "completed" ? "text.disabled" : "text.primary",
        animation: step.status === "completed" ? "taskStepComplete 280ms ease-out" : "none",
        "@keyframes taskStepComplete": {
          from: { opacity: 0.58, transform: "translateX(-3px)" },
          to: { opacity: 1, transform: "translateX(0)" }
        }
      }}
    >
      <Box sx={{ width: 18, height: 18, mt: "1px", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
        {step.status === "completed" ? (
          <CheckCircleIcon sx={{ fontSize: 17, color: "success.main" }} />
        ) : step.status === "inProgress" ? (
          <CircularProgress size={15} thickness={5} />
        ) : (
          <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        )}
      </Box>
      <Typography
        variant="body2"
        sx={{
          minWidth: 0,
          lineHeight: 1.35,
          fontWeight: step.status === "inProgress" ? 750 : 500,
          textDecoration: step.status === "completed" ? "line-through" : "none",
          overflowWrap: "anywhere"
        }}
      >
        {step.text}
      </Typography>
    </Stack>
  );
}
