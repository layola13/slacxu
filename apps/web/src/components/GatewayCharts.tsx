import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useMemo } from "react";
import type { TranslateFn } from "../i18n";
export type RangeKey = "all" | "month" | "week" | "day";

export const RANGE_DAYS: Record<RangeKey, number> = { all: 365, month: 30, week: 7, day: 1 };

export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100) return `$${n.toFixed(0)}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function RangeTabs({ value, onChange, t }: { value: RangeKey; onChange: (v: RangeKey) => void; t: TranslateFn }) {
  return (
    <ToggleButtonGroup size="small" exclusive value={value} onChange={(_, v) => v && onChange(v)}>
      {(["all", "month", "week", "day"] as RangeKey[]).map((key) => (
        <ToggleButton key={key} value={key}>{t(`settings.gateway.range.${key}`)}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

type Margin = { top: number; right: number; bottom: number; left: number };

export function DailyComboChart({ data }: {
  data: Array<{ date: string; count: number; tokens: number; cost: number }>;
}) {
  const width = 640;
  const height = 260;
  const margin: Margin = { top: 12, right: 64, bottom: 28, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const maxTokens = Math.max(1, ...data.map((d) => d.tokens));
  const maxCost = Math.max(0.0001, ...data.map((d) => d.cost));
  const stepX = data.length > 1 ? innerW / data.length : innerW;
  const x = (i: number) => margin.left + stepX * i + stepX / 2;
  const yCount = (v: number) => margin.top + innerH - (v / maxCount) * innerH;
  const yTokens = (v: number) => margin.top + innerH - (v / maxTokens) * innerH;
  const yCost = (v: number) => margin.top + innerH - (v / maxCost) * innerH;
  const areaPath = useMemo(() => {
    if (data.length === 0) return "";
    const pts = data.map((d, i) => `${x(i)},${yTokens(d.tokens)}`).join(" L");
    return `M${x(0)},${margin.top + innerH} L${pts} L${x(data.length - 1)},${margin.top + innerH} Z`;
  }, [data]);
  const costPath = useMemo(() => data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${yCost(d.cost)}`).join(" "), [data]);
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img">
      <defs>
        <linearGradient id="gw-token-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b3552e" stopOpacity={0.45} />
          <stop offset="100%" stopColor="#b3552e" stopOpacity={0.05} />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = margin.top + (innerH / 4) * i;
        return <line key={i} x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="3 3" />;
      })}
      {data.map((d, i) => (
        <rect
          key={d.date}
          x={x(i) - Math.max(2, stepX * 0.22)}
          y={yCount(d.count)}
          width={Math.max(4, stepX * 0.44)}
          height={Math.max(1, margin.top + innerH - yCount(d.count))}
          rx={2}
          fill="#b3552e"
          opacity={0.85}
        />
      ))}
      {areaPath ? <path d={areaPath} fill="url(#gw-token-area)" /> : null}
      {data.map((d, i) => (
        <circle key={d.date} cx={x(i)} cy={yTokens(d.tokens)} r={2.5} fill="#b3552e" />
      ))}
      {costPath ? <path d={costPath} fill="none" stroke="#2e7d5b" strokeWidth={2} /> : null}
      {[0, 1, 2, 3, 4].map((i) => {
        const v = Math.round((maxCount / 4) * (4 - i));
        const y = margin.top + (innerH / 4) * i;
        return <text key={i} x={margin.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.6}>{formatCount(v)}</text>;
      })}
      {[0, 2, 4].map((i) => {
        const v = (maxCost / 4) * (4 - i);
        const y = margin.top + (innerH / 4) * i;
        return <text key={i} x={width - margin.right + 6} y={y + 4} fontSize={10} fill="currentColor" opacity={0.6}>{formatMoney(v)}</text>;
      })}
      {/* Token 为面积+圆点层，不再单独占右侧数字轴，避免美元轴与 Token 轴标签重叠（如 $130641.6M）。最大值见下方图例/tooltip。 */}
      {data.map((d, i) => i % labelEvery === 0 ? (
        <text key={d.date} x={x(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>
          {d.date.slice(5)}
        </text>
      ) : null)}
    </svg>
  );
}

export function ReqCostBars({ rows }: { rows: Array<{ name: string; count: number; cost: number }> }) {
  const width = 560;
  const height = 240;
  const margin: Margin = { top: 12, right: 52, bottom: 28, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const maxCost = Math.max(0.0001, ...rows.map((r) => r.cost));
  const slot = rows.length > 0 ? innerW / rows.length : innerW;
  const yCount = (v: number) => margin.top + innerH - (v / maxCount) * innerH;
  const yCost = (v: number) => margin.top + innerH - (v / maxCost) * innerH;
  const costPath = rows.map((r, i) => {
    const cx = margin.left + slot * i + slot / 2;
    return `${i === 0 ? "M" : "L"}${cx},${yCost(r.cost)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img">
      {[0, 1, 2, 3, 4].map((i) => {
        const y = margin.top + (innerH / 4) * i;
        return <line key={i} x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="3 3" />;
      })}
      {rows.map((r, i) => {
        const cx = margin.left + slot * i + slot / 2;
        const w = Math.min(56, Math.max(10, slot * 0.4));
        return (
          <g key={r.name}>
            <rect x={cx - w / 2} y={yCount(r.count)} width={w} height={Math.max(1, margin.top + innerH - yCount(r.count))} rx={4} fill="#b3552e" opacity={0.9} />
            <circle cx={cx} cy={yCost(r.cost)} r={3} fill="#2e7d5b" />
          </g>
        );
      })}
      {rows.length > 1 ? <path d={costPath} fill="none" stroke="#2e7d5b" strokeWidth={2} /> : null}
      {[0, 1, 2, 3, 4].map((i) => {
        const v = Math.round((maxCount / 4) * (4 - i));
        const y = margin.top + (innerH / 4) * i;
        return <text key={i} x={margin.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.6}>{formatCount(v)}</text>;
      })}
      {[0, 2, 4].map((i) => {
        const v = (maxCost / 4) * (4 - i);
        const y = margin.top + (innerH / 4) * i;
        return <text key={i} x={width - margin.right + 6} y={y + 4} fontSize={10} fill="currentColor" opacity={0.6}>{formatMoney(v)}</text>;
      })}
      {rows.map((r, i) => {
        const cx = margin.left + slot * i + slot / 2;
        return (
          <text key={r.name} x={cx} y={height - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>
            {(r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name)}
          </text>
        );
      })}
    </svg>
  );
}

export function TokenGroupedBars({ rows }: { rows: Array<{ name: string; input: number; output: number; cached: number }> }) {
  const width = 560;
  const height = 240;
  const margin: Margin = { top: 12, right: 12, bottom: 28, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxV = Math.max(1, ...rows.flatMap((r) => [r.input, r.output, r.cached]));
  const slot = rows.length > 0 ? innerW / rows.length : innerW;
  const y = (v: number) => margin.top + innerH - (v / maxV) * innerH;
  const colors = ["#b3552e", "#2e7d5b", "#8a8a8a"];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img">
      {[0, 1, 2, 3, 4].map((i) => {
        const yy = margin.top + (innerH / 4) * i;
        return <line key={i} x1={margin.left} x2={width - margin.right} y1={yy} y2={yy} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="3 3" />;
      })}
      {rows.map((r, i) => {
        const cx = margin.left + slot * i + slot / 2;
        const vals = [r.input, r.output, r.cached];
        const w = Math.min(22, Math.max(6, slot * 0.16));
        const gap = 3;
        return (
          <g key={r.name}>
            {vals.map((v, j) => (
              <rect
                key={j}
                x={cx - (w * 3 + gap * 2) / 2 + j * (w + gap)}
                y={y(v)}
                width={w}
                height={Math.max(1, margin.top + innerH - y(v))}
                rx={3}
                fill={colors[j]}
                opacity={0.9}
              />
            ))}
            <text x={cx} y={height - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>
              {(r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name)}
            </text>
          </g>
        );
      })}
      {[0, 1, 2, 3, 4].map((i) => {
        const v = (maxV / 4) * (4 - i);
        const yy = margin.top + (innerH / 4) * i;
        return <text key={i} x={margin.left - 6} y={yy + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.6}>{formatCount(v)}</text>;
      })}
    </svg>
  );
}

export function RankLegend({ rows, totalKey }: {
  rows: Array<{ name: string; total: number; cost?: number }>;
  totalKey: "total" | "cost" | "count";
}) {
  const grand = rows.reduce((sum, r) => sum + (totalKey === "cost" ? (r.cost ?? 0) : totalKey === "count" ? (r as unknown as { count: number }).count ?? 0 : r.total), 0);
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      {rows.map((r, i) => {
        const value = totalKey === "cost" ? (r.cost ?? 0) : totalKey === "count" ? (r as unknown as { count: number }).count ?? 0 : r.total;
        const pct = grand > 0 ? (value / grand) * 100 : 0;
        const text = totalKey === "cost" ? formatMoney(value) : formatCount(value);
        return (
          <Stack key={r.name} direction="row" spacing={1} alignItems="baseline">
            <Typography variant="body2" color="text.secondary" sx={{ width: 32 }}>{String(i + 1).padStart(2, "0")}.</Typography>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: i === 0 ? "#b3552e" : "#8a8a8a", flexShrink: 0 }} />
            <Typography variant="body2" sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{text}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ width: 52, textAlign: "right" }}>{pct.toFixed(1)}%</Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}
