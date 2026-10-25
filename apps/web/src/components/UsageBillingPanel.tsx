import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import BarChartIcon from "@mui/icons-material/BarChart";
import RefreshIcon from "@mui/icons-material/Refresh";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import BoltIcon from "@mui/icons-material/Bolt";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUser, BalanceLedgerEntry, UsageSummary } from "@codex-ui/shared";
import type { TranslateFn } from "../i18n";
import { allocateMemberBalance, fetchUsageLedger, fetchUsageSummary } from "../state/codexClient";

type Props = {
  token: string;
  currentUser: AuthUser | null;
  members?: AuthUser[];
  t: TranslateFn;
  onBalanceChanged?: () => void;
};

/**
 * Sub2API-inspired usage + recharge view:
 * stats cards, daily spend/credit bars, operation breakdown, ledger table.
 * Admins can also top-up members from this page.
 */
export function UsageBillingPanel({ token, currentUser, members = [], t, onBalanceChanged }: Props) {
  const isAdmin = currentUser?.role === "admin";
  const [days, setDays] = useState(7);
  const [filterUserId, setFilterUserId] = useState<string>("");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [ledger, setLedger] = useState<BalanceLedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin quick recharge
  const [rechargeUserId, setRechargeUserId] = useState("");
  const [rechargeAmount, setRechargeAmount] = useState("10");
  const [rechargeOp, setRechargeOp] = useState<"add" | "set" | "subtract">("add");
  const [rechargeNotes, setRechargeNotes] = useState("");
  const [recharging, setRecharging] = useState(false);
  const [rechargeMsg, setRechargeMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const userId = isAdmin && filterUserId ? filterUserId : undefined;
      const [s, l] = await Promise.all([
        fetchUsageSummary(token, { days, userId }),
        fetchUsageLedger(token, { limit: 80, userId })
      ]);
      setSummary(s);
      setLedger(l as BalanceLedgerEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [days, filterUserId, isAdmin, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const maxDaily = useMemo(() => {
    if (!summary?.daily?.length) return 1;
    return Math.max(1, ...summary.daily.map((d) => Math.max(d.debit, d.credit)));
  }, [summary]);

  const doRecharge = async () => {
    if (!isAdmin || !rechargeUserId || recharging) return;
    const amount = Number(rechargeAmount);
    if (!Number.isFinite(amount) || amount < 0 || (rechargeOp !== "set" && !(amount > 0))) {
      setError(t("settings.usage.invalidAmount"));
      return;
    }
    setRecharging(true);
    setError(null);
    setRechargeMsg(null);
    try {
      await allocateMemberBalance(token, rechargeUserId, {
        amount,
        operation: rechargeOp,
        notes: rechargeNotes.trim() || undefined
      });
      setRechargeMsg(t("settings.usage.rechargeOk"));
      setRechargeNotes("");
      onBalanceChanged?.();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecharging(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <BarChartIcon color="primary" />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 900 }}>
              {t("settings.usage.title")}
            </Typography>
            <Typography color="text.secondary">{t("settings.usage.subtitle")}</Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {isAdmin ? (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>{t("settings.usage.filterUser")}</InputLabel>
              <Select
                label={t("settings.usage.filterUser")}
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
              >
                <MenuItem value="">{t("settings.usage.allUsers")}</MenuItem>
                {members.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.email}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>{t("settings.usage.days")}</InputLabel>
            <Select label={t("settings.usage.days")} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 7, 14, 30].map((d) => (
                <MenuItem key={d} value={String(d)}>
                  {t("settings.usage.daysN", { n: d })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => void reload()} disabled={loading} sx={{ borderRadius: 999 }}>
            {t("settings.usage.refresh")}
          </Button>
        </Stack>
      </Stack>

      {error ? (
        <Alert severity="error" variant="outlined" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {rechargeMsg ? (
        <Alert severity="success" variant="outlined" onClose={() => setRechargeMsg(null)}>
          {rechargeMsg}
        </Alert>
      ) : null}

      {loading && !summary ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography color="text.secondary">{t("settings.usage.loading")}</Typography>
        </Stack>
      ) : null}

      {summary ? (
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }
          }}
        >
          <StatCard
            icon={<AccountBalanceWalletIcon fontSize="small" />}
            label={t("settings.usage.balance")}
            value={summary.balance === null ? "—" : summary.balance.toFixed(2)}
            color="#38bdf8"
          />
          <StatCard
            icon={<TrendingDownIcon fontSize="small" />}
            label={t("settings.usage.totalDebit")}
            value={summary.totalDebit.toFixed(2)}
            color="#f87171"
          />
          <StatCard
            icon={<TrendingUpIcon fontSize="small" />}
            label={t("settings.usage.totalCredit")}
            value={summary.totalCredit.toFixed(2)}
            color="#4ade80"
          />
          <StatCard
            icon={<BoltIcon fontSize="small" />}
            label={t("settings.usage.turns")}
            value={String(summary.turnCount)}
            sub={t("settings.usage.todayDebit", { amount: summary.todayDebit.toFixed(2) })}
            color="#a78bfa"
          />
        </Box>
      ) : null}

      {isAdmin ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 850, mb: 1.25 }}>
            {t("settings.usage.rechargeTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("settings.usage.rechargeHint")}
          </Typography>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.25}>
            <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
              <InputLabel>{t("settings.usage.member")}</InputLabel>
              <Select label={t("settings.usage.member")} value={rechargeUserId} onChange={(e) => setRechargeUserId(e.target.value)}>
                {members
                  .filter((m) => m.role !== "admin" || true)
                  .map((m) => (
                    <MenuItem key={m.id} value={m.id}>
                      {m.email} ({Number(m.balance).toFixed(2)})
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>{t("settings.permissions.balanceOp")}</InputLabel>
              <Select label={t("settings.permissions.balanceOp")} value={rechargeOp} onChange={(e) => setRechargeOp(e.target.value as "add" | "set" | "subtract")}>
                <MenuItem value="add">{t("settings.permissions.balanceAdd")}</MenuItem>
                <MenuItem value="set">{t("settings.permissions.balanceSet")}</MenuItem>
                <MenuItem value="subtract">{t("settings.permissions.balanceSubtract")}</MenuItem>
              </Select>
            </FormControl>
            <TextField size="small" type="number" label={t("settings.permissions.amount")} value={rechargeAmount} onChange={(e) => setRechargeAmount(e.target.value)} sx={{ width: 120 }} />
            <TextField size="small" label={t("settings.permissions.notes")} value={rechargeNotes} onChange={(e) => setRechargeNotes(e.target.value)} sx={{ flex: 1 }} />
            <Button variant="contained" disabled={recharging || !rechargeUserId} onClick={() => void doRecharge()} sx={{ borderRadius: 999, fontWeight: 800 }}>
              {recharging ? t("settings.permissions.saving") : t("settings.usage.recharge")}
            </Button>
          </Stack>
        </Paper>
      ) : null}

      {summary ? (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1.4fr 1fr" } }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 850, mb: 1 }}>
              {t("settings.usage.dailyChart")}
            </Typography>
            <Stack spacing={1}>
              {summary.daily.map((point) => (
                <Stack key={point.date} direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ width: 78, fontFamily: "JetBrains Mono, monospace", color: "text.secondary" }}>
                    {point.date.slice(5)}
                  </Typography>
                  <Box sx={{ flex: 1, position: "relative", height: 18, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
                    <Box
                      sx={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${(point.debit / maxDaily) * 100}%`,
                        bgcolor: "error.main",
                        opacity: 0.75,
                        borderRadius: 1
                      }}
                    />
                    <Box
                      sx={{
                        position: "absolute",
                        left: 0,
                        top: "55%",
                        bottom: 0,
                        width: `${(point.credit / maxDaily) * 100}%`,
                        bgcolor: "success.main",
                        opacity: 0.85,
                        borderRadius: 1
                      }}
                    />
                  </Box>
                  <Typography variant="caption" sx={{ width: 88, textAlign: "right", fontFamily: "JetBrains Mono, monospace" }}>
                    -{point.debit.toFixed(2)} / +{point.credit.toFixed(2)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Chip size="small" label={t("settings.usage.legendDebit")} color="error" variant="outlined" />
              <Chip size="small" label={t("settings.usage.legendCredit")} color="success" variant="outlined" />
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 850, mb: 1 }}>
              {t("settings.usage.byOperation")}
            </Typography>
            {summary.byOperation.length === 0 ? (
              <Typography color="text.secondary" variant="body2">
                {t("settings.usage.empty")}
              </Typography>
            ) : (
              <Stack spacing={1}>
                {summary.byOperation.map((op) => {
                  const max = Math.max(1, ...summary.byOperation.map((x) => x.total));
                  return (
                    <Box key={op.operation}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {op.operation}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {op.count} · {op.total.toFixed(2)}
                        </Typography>
                      </Stack>
                      <Box sx={{ height: 8, borderRadius: 999, bgcolor: "action.hover", mt: 0.5, overflow: "hidden" }}>
                        <Box sx={{ height: "100%", width: `${(op.total / max) * 100}%`, bgcolor: "primary.main", borderRadius: 999 }} />
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            )}

            {isAdmin && summary.topUsers && summary.topUsers.length > 0 ? (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  {t("settings.usage.topUsers")}
                </Typography>
                <Stack spacing={0.75}>
                  {summary.topUsers.map((u) => (
                    <Stack key={u.userId} direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2" noWrap sx={{ maxWidth: "70%" }}>
                        {u.email}
                      </Typography>
                      <Chip size="small" label={`${u.debit.toFixed(2)} / ${u.turns}`} variant="outlined" />
                    </Stack>
                  ))}
                </Stack>
              </Box>
            ) : null}
          </Paper>
        </Box>
      ) : null}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
            {t("settings.usage.ledger")}
          </Typography>
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("settings.usage.time")}</TableCell>
              {isAdmin ? <TableCell>{t("settings.usage.user")}</TableCell> : null}
              <TableCell>{t("settings.usage.operation")}</TableCell>
              <TableCell align="right">{t("settings.usage.delta")}</TableCell>
              <TableCell align="right">{t("settings.usage.after")}</TableCell>
              <TableCell>{t("settings.usage.reason")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ledger.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5}>
                  <Typography color="text.secondary" variant="body2" sx={{ py: 2, textAlign: "center" }}>
                    {t("settings.usage.empty")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              ledger.map((row) => (
                <TableRow key={String(row.id)} hover>
                  <TableCell sx={{ whiteSpace: "nowrap", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
                    {formatTs(Number(row.created_at))}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell sx={{ maxWidth: 160 }}>
                      <Typography variant="body2" noWrap>
                        {(row as BalanceLedgerEntry).user_email || row.user_id}
                      </Typography>
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Chip size="small" label={row.operation} variant="outlined" color={row.operation === "debit" ? "error" : row.operation === "add" ? "success" : "default"} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "JetBrains Mono, monospace", color: Number(row.delta) < 0 ? "error.main" : "success.main" }}>
                    {Number(row.delta) > 0 ? "+" : ""}
                    {Number(row.delta).toFixed(2)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
                    {Number(row.balance_after).toFixed(2)}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {row.reason || row.method || "—"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  color
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.75,
        borderRadius: 2,
        background: `linear-gradient(145deg, ${color}14, transparent 70%)`,
        borderColor: `${color}44`
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75, color }}>
        {icon}
        <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>
          {label}
        </Typography>
      </Stack>
      <Typography variant="h5" sx={{ fontWeight: 900, fontFamily: "JetBrains Mono, monospace" }}>
        {value}
      </Typography>
      {sub ? (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      ) : null}
    </Paper>
  );
}

function formatTs(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}
