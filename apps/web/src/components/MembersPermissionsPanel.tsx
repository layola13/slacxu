import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import SecurityIcon from "@mui/icons-material/Security";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { useMemo, useState } from "react";
import { permissionPresets, type AuthUser, type PermissionPresetId, type ProviderConfig } from "@codex-ui/shared";
import type { TranslateFn } from "../i18n";

export type CreateMemberInput = {
  email: string;
  password: string;
  username?: string;
  role?: "admin" | "user";
  maxPermission?: PermissionPresetId;
  allowWrite?: boolean;
  allowNetwork?: boolean;
  allowDangerBypass?: boolean;
  balance?: number;
  concurrency?: number;
  notes?: string;
  allowedProviderIds?: string[];
};

type Props = {
  members: AuthUser[];
  providers?: ProviderConfig[];
  loading: boolean;
  error: string | null;
  t: TranslateFn;
  onReload: () => Promise<void>;
  onCreate: (input: CreateMemberInput) => Promise<void>;
  onUpdate: (id: string, input: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAllocateBalance?: (id: string, amount: number, operation?: "set" | "add" | "subtract", notes?: string) => Promise<void>;
};

type RoleFilter = "" | "admin" | "user";
type StatusFilter = "" | "active" | "disabled";
type BalanceOp = "add" | "set" | "subtract";

type EditForm = {
  email: string;
  username: string;
  password: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  maxPermission: PermissionPresetId;
  allowWrite: boolean;
  allowNetwork: boolean;
  allowDangerBypass: boolean;
  concurrency: string;
  notes: string;
  allowedProviders: string[];
};

type CreateFormState = {
  email: string;
  password: string;
  username: string;
  role: "admin" | "user";
  maxPermission: PermissionPresetId;
  allowWrite: boolean;
  allowNetwork: boolean;
  allowDangerBypass: boolean;
  balance: string;
  concurrency: string;
  notes: string;
  allowedProviders: string[];
};

const emptyCreate: CreateFormState = {
  email: "",
  password: "",
  username: "",
  role: "user",
  maxPermission: "workspaceAsk",
  allowWrite: true,
  allowNetwork: false,
  allowDangerBypass: false,
  balance: "10",
  concurrency: "5",
  notes: "",
  allowedProviders: []
};

/**
 * Sub2API-inspired admin page for membership + capability matrix.
 * Server still enforces caps; this is the configuration surface.
 */
export function MembersPermissionsPanel({
  members,
  providers = [],
  loading,
  error,
  t,
  onReload,
  onCreate,
  onUpdate,
  onDelete,
  onAllocateBalance
}: Props) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [creating, setCreating] = useState(false);

  const [editUser, setEditUser] = useState<AuthUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const [balanceUser, setBalanceUser] = useState<AuthUser | null>(null);
  const [balanceOp, setBalanceOp] = useState<BalanceOp>("add");
  const [balanceAmount, setBalanceAmount] = useState("10");
  const [balanceNotes, setBalanceNotes] = useState("");
  const [allocating, setAllocating] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => {
      if (roleFilter && member.role !== roleFilter) {
        return false;
      }
      if (statusFilter && member.status !== statusFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [member.email, member.username, member.role, member.status, member.workspaceRoot, member.notes, member.maxPermission]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [members, roleFilter, search, statusFilter]);

  const stats = useMemo(() => {
    const admins = members.filter((m) => m.role === "admin").length;
    const active = members.filter((m) => m.status === "active").length;
    const totalBalance = members.reduce((sum, m) => sum + (Number(m.balance) || 0), 0);
    return { total: members.length, admins, active, totalBalance };
  }, [members]);

  const openEdit = (member: AuthUser) => {
    setFormError(null);
    setEditUser(member);
    setEditForm({
      email: member.email,
      username: member.username ?? "",
      password: "",
      role: member.role,
      status: member.status,
      maxPermission: member.maxPermission,
      allowWrite: member.allowWrite,
      allowNetwork: member.allowNetwork,
      allowDangerBypass: member.allowDangerBypass,
      concurrency: String(member.concurrency ?? 5),
      notes: member.notes ?? "",
      allowedProviders: member.allowedProviderIds ?? []
    });
  };

  const submitCreate = async () => {
    if (creating) {
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      await onCreate({
        email: createForm.email.trim(),
        password: createForm.password,
        username: createForm.username.trim() || undefined,
        role: createForm.role,
        maxPermission: createForm.maxPermission,
        allowWrite: createForm.allowWrite,
        allowNetwork: createForm.allowNetwork,
        allowDangerBypass: createForm.allowDangerBypass,
        balance: Number(createForm.balance) || 0,
        concurrency: Math.min(100, Math.max(1, Number(createForm.concurrency) || 1)),
        notes: createForm.notes.trim() || undefined,
        allowedProviderIds: createForm.role === "admin" ? undefined : createForm.allowedProviders
      });
      setCreateForm(emptyCreate);
      setCreateOpen(false);
      await onReload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const submitEdit = async () => {
    if (!editUser || !editForm || saving) {
      return;
    }
    setFormError(null);
    setSaving(true);
    setBusyId(editUser.id);
    try {
      const payload: Record<string, unknown> = {
        email: editForm.email.trim(),
        username: editForm.username.trim(),
        role: editForm.role,
        status: editForm.status,
        maxPermission: editForm.maxPermission,
        allowWrite: editForm.allowWrite,
        allowNetwork: editForm.allowNetwork,
        allowDangerBypass: editForm.allowDangerBypass,
        concurrency: Math.min(100, Math.max(1, Number(editForm.concurrency) || 1)),
        notes: editForm.notes,
        allowedProviderIds: editForm.allowedProviders
      };
      if (editForm.password.trim()) {
        payload.password = editForm.password.trim();
      }
      await onUpdate(editUser.id, payload);
      setEditUser(null);
      setEditForm(null);
      await onReload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setBusyId(null);
    }
  };

  const submitBalance = async () => {
    if (!balanceUser || !onAllocateBalance || allocating) {
      return;
    }
    const amount = Number(balanceAmount);
    if (!Number.isFinite(amount) || amount < 0 || (balanceOp !== "set" && !(amount > 0))) {
      setFormError(t("settings.permissions.invalidAmount"));
      return;
    }
    setFormError(null);
    setAllocating(true);
    setBusyId(balanceUser.id);
    try {
      await onAllocateBalance(balanceUser.id, amount, balanceOp, balanceNotes.trim() || undefined);
      setBalanceUser(null);
      await onReload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setAllocating(false);
      setBusyId(null);
    }
  };

  const handleDelete = async (member: AuthUser) => {
    if (!window.confirm(t("settings.members.deleteConfirm", { email: member.email }))) {
      return;
    }
    setBusyId(member.id);
    setFormError(null);
    try {
      await onDelete(member.id);
      await onReload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const quickToggle = async (member: AuthUser, patch: Record<string, unknown>) => {
    setBusyId(member.id);
    setFormError(null);
    try {
      await onUpdate(member.id, patch);
      await onReload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box sx={{ bgcolor: "background.default" }}>
      <Stack spacing={2.5}>
        {/* Header — Sub2API-like page chrome */}
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ xs: "stretch", md: "flex-end" }} justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <SecurityIcon color="primary" />
              <Typography variant="h4" sx={{ fontWeight: 900, fontSize: { xs: 26, sm: 34 }, lineHeight: 1.1 }}>
                {t("settings.permissions.title")}
              </Typography>
            </Stack>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 0.75, maxWidth: 720 }}>
              {t("settings.permissions.subtitle")}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ xs: "flex-start", md: "flex-end" }}>
            <Button size="small" variant="outlined" startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />} onClick={() => void onReload()} disabled={loading} sx={{ borderRadius: 999 }}>
              {t("settings.members.reload")}
            </Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => { setFormError(null); setCreateOpen(true); }} sx={{ borderRadius: 999 }}>
              {t("settings.permissions.createUser")}
            </Button>
          </Stack>
        </Stack>

        {/* Stats */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" color="primary" label={t("settings.permissions.statTotal", { count: stats.total })} sx={{ borderRadius: 999, fontWeight: 800 }} />
          <Chip size="small" variant="outlined" label={t("settings.permissions.statAdmins", { count: stats.admins })} sx={{ borderRadius: 999 }} />
          <Chip size="small" color="success" variant="outlined" label={t("settings.permissions.statActive", { count: stats.active })} sx={{ borderRadius: 999 }} />
          <Chip size="small" color="secondary" variant="outlined" icon={<AccountBalanceWalletIcon />} label={t("settings.permissions.statBalance", { amount: stats.totalBalance.toFixed(2) })} sx={{ borderRadius: 999 }} />
        </Stack>

        {/* Policy matrix legend */}
        <Paper
          variant="outlined"
          sx={{
            p: 1.75,
            borderRadius: 2,
            bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(17,24,39,0.55)" : "rgba(255,255,255,0.72)"),
            backdropFilter: "blur(12px)"
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
            {t("settings.permissions.matrixTitle")}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 800 }}>{t("settings.permissions.capability")}</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>{t("settings.permissions.adminRole")}</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>{t("settings.permissions.memberRole")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[
                ["settings.permissions.capChat", "settings.permissions.yes", "settings.permissions.ownOnly"],
                ["settings.permissions.capCodexConfig", "settings.permissions.yes", "settings.permissions.readOnlyUse"],
                ["settings.permissions.capRelayEdit", "settings.permissions.yes", "settings.permissions.no"],
                ["settings.permissions.capRelayUse", "settings.permissions.yes", "settings.permissions.yes"],
                ["settings.permissions.capWorkspace", "settings.permissions.anyPath", "settings.permissions.ownRoot"],
                ["settings.permissions.capBalance", "settings.permissions.allocate", "settings.permissions.consume"],
                ["settings.permissions.capDanger", "settings.permissions.yes", "settings.permissions.ifAllowed"]
              ].map(([cap, admin, member]) => (
                <TableRow key={cap}>
                  <TableCell>{t(cap as never)}</TableCell>
                  <TableCell>
                    <Chip size="small" color="success" variant="outlined" label={t(admin as never)} />
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={t(member as never)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>

        {(error || formError) && (
          <Alert severity="error" variant="outlined" onClose={() => setFormError(null)}>
            {formError || error}
          </Alert>
        )}

        {/* Filters row */}
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ xs: "stretch", md: "center" }}>
          <TextField
            size="small"
            placeholder={t("settings.permissions.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
                </InputAdornment>
              )
            }}
            sx={{
              flex: 1,
              maxWidth: { md: 420 },
              "& .MuiOutlinedInput-root": { borderRadius: 999, bgcolor: "background.paper" }
            }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t("settings.members.role")}</InputLabel>
            <Select label={t("settings.members.role")} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}>
              <MenuItem value="">{t("settings.permissions.allRoles")}</MenuItem>
              <MenuItem value="admin">{t("settings.permissions.roleAdmin")}</MenuItem>
              <MenuItem value="user">{t("settings.permissions.roleUser")}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t("settings.members.status")}</InputLabel>
            <Select label={t("settings.members.status")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
              <MenuItem value="">{t("settings.permissions.allStatus")}</MenuItem>
              <MenuItem value="active">{t("settings.permissions.statusActive")}</MenuItem>
              <MenuItem value="disabled">{t("settings.permissions.statusDisabled")}</MenuItem>
            </Select>
          </FormControl>
        </Stack>

        {/* Users table */}
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{
            borderRadius: 2,
            bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(17, 24, 39, 0.72)" : "rgba(255, 255, 255, 0.72)"),
            backdropFilter: "blur(18px)",
            overflowX: "auto"
          }}
        >
          <Table size="small" stickyHeader sx={{ minWidth: 1100 }}>
            <TableHead>
              <TableRow
                sx={{
                  "& th": {
                    bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(31, 41, 55, 0.92)" : "rgba(231, 233, 228, 0.92)"),
                    fontWeight: 850,
                    color: "text.secondary",
                    borderColor: "divider",
                    py: 1.35
                  }
                }}
              >
                <TableCell>{t("settings.permissions.colUser")}</TableCell>
                <TableCell>{t("settings.members.role")}</TableCell>
                <TableCell>{t("settings.members.status")}</TableCell>
                <TableCell align="right">{t("settings.members.balance")}</TableCell>
                <TableCell align="center">{t("settings.permissions.concurrency")}</TableCell>
                <TableCell>{t("settings.members.maxPermission")}</TableCell>
                <TableCell align="center">{t("settings.permissions.write")}</TableCell>
                <TableCell align="center">{t("settings.permissions.network")}</TableCell>
                <TableCell align="center">{t("settings.permissions.danger")}</TableCell>
                <TableCell align="center">{t("settings.permissions.relays")}</TableCell>
                <TableCell>{t("settings.permissions.workspace")}</TableCell>
                <TableCell align="right">{t("settings.members.actions")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                      <CircularProgress size={18} />
                      <Typography color="text.secondary">{t("settings.members.loading")}</Typography>
                    </Stack>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12}>
                    <Typography color="text.secondary" sx={{ py: 2 }}>
                      {t("settings.permissions.empty")}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((member) => {
                  const busy = busyId === member.id;
                  return (
                    <TableRow key={member.id} hover sx={{ opacity: busy ? 0.7 : 1 }}>
                      <TableCell>
                        <Stack spacing={0.15}>
                          <Typography variant="body2" sx={{ fontWeight: 750 }}>
                            {member.email}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {member.username || "—"} · {member.id.slice(0, 8)}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={member.role === "admin" ? t("settings.permissions.roleAdmin") : t("settings.permissions.roleUser")}
                          color={member.role === "admin" ? "warning" : "default"}
                          variant={member.role === "admin" ? "filled" : "outlined"}
                          sx={{ fontWeight: 700 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Switch
                          size="small"
                          checked={member.status === "active"}
                          disabled={busy || member.role === "admin"}
                          onChange={(event) => void quickToggle(member, { status: event.target.checked ? "active" : "disabled" })}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
                          {Number(member.balance).toFixed(2)}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="body2" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
                          {member.concurrency}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={presetLabel(member.maxPermission)} variant="outlined" />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox
                          size="small"
                          checked={member.allowWrite}
                          disabled={busy || member.role === "admin"}
                          onChange={(event) => void quickToggle(member, { allowWrite: event.target.checked })}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox
                          size="small"
                          checked={member.allowNetwork}
                          disabled={busy || member.role === "admin"}
                          onChange={(event) => void quickToggle(member, { allowNetwork: event.target.checked })}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox
                          size="small"
                          checked={member.allowDangerBypass}
                          disabled={busy || member.role === "admin"}
                          onChange={(event) => void quickToggle(member, { allowDangerBypass: event.target.checked })}
                          color="warning"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          size="small"
                          label={
                            member.role === "admin"
                              ? t("settings.permissions.allRelays")
                              : String((member.allowedProviderIds ?? []).length)
                          }
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>
                        <Tooltip title={member.workspaceRoot || ""}>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontFamily: "JetBrains Mono, monospace" }}>
                            {member.workspaceRoot || "—"}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Tooltip title={t("settings.members.allocate")}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={busy}
                                onClick={() => {
                                  setFormError(null);
                                  setBalanceUser(member);
                                  setBalanceOp("add");
                                  setBalanceAmount("10");
                                  setBalanceNotes("");
                                }}
                              >
                                <AccountBalanceWalletIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={t("settings.permissions.edit")}>
                            <span>
                              <IconButton size="small" disabled={busy} onClick={() => openEdit(member)}>
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={t("settings.members.delete")}>
                            <span>
                              <IconButton size="small" color="error" disabled={busy || member.role === "admin"} onClick={() => void handleDelete(member)}>
                                {busy ? <CircularProgress size={14} /> : <DeleteOutlineIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="body2" color="text.secondary">
          {t("settings.permissions.showing", { count: filtered.length, total: members.length })}
        </Typography>

        <Alert severity="info" variant="outlined">
          {t("settings.members.securityNote")}
        </Alert>
      </Stack>

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 850 }}>{t("settings.permissions.createUser")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField size="small" required label={t("settings.members.email")} value={createForm.email} onChange={(e) => setCreateForm((c) => ({ ...c, email: e.target.value }))} />
            <TextField size="small" required type="password" label={t("settings.members.password")} value={createForm.password} onChange={(e) => setCreateForm((c) => ({ ...c, password: e.target.value }))} />
            <TextField size="small" label={t("settings.members.username")} value={createForm.username} onChange={(e) => setCreateForm((c) => ({ ...c, username: e.target.value }))} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settings.members.role")}</InputLabel>
                <Select label={t("settings.members.role")} value={createForm.role} onChange={(e) => setCreateForm((c) => ({ ...c, role: e.target.value as "admin" | "user" }))}>
                  <MenuItem value="user">{t("settings.permissions.roleUser")}</MenuItem>
                  <MenuItem value="admin">{t("settings.permissions.roleAdmin")}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settings.members.maxPermission")}</InputLabel>
                <Select
                  label={t("settings.members.maxPermission")}
                  value={createForm.maxPermission}
                  onChange={(e) => setCreateForm((c) => ({ ...c, maxPermission: e.target.value as PermissionPresetId }))}
                >
                  {permissionPresets.map((preset) => (
                    <MenuItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
              <TextField size="small" type="number" label={t("settings.members.balance")} value={createForm.balance} onChange={(e) => setCreateForm((c) => ({ ...c, balance: e.target.value }))} fullWidth />
              <TextField size="small" type="number" label={t("settings.permissions.concurrency")} value={createForm.concurrency} onChange={(e) => setCreateForm((c) => ({ ...c, concurrency: e.target.value }))} fullWidth />
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <FormControlLabel control={<Checkbox checked={createForm.allowWrite} onChange={(e) => setCreateForm((c) => ({ ...c, allowWrite: e.target.checked }))} />} label={t("settings.permissions.write")} />
              <FormControlLabel control={<Checkbox checked={createForm.allowNetwork} onChange={(e) => setCreateForm((c) => ({ ...c, allowNetwork: e.target.checked }))} />} label={t("settings.permissions.network")} />
              <FormControlLabel control={<Checkbox checked={createForm.allowDangerBypass} onChange={(e) => setCreateForm((c) => ({ ...c, allowDangerBypass: e.target.checked }))} />} label={t("settings.permissions.danger")} />
            </Stack>
            {createForm.role === "admin" ? (
              <Alert severity="info" variant="outlined">
                {t("settings.permissions.adminAllRelays")}
              </Alert>
            ) : (
              <RelayAccessPicker
                providers={providers}
                selected={createForm.allowedProviders}
                onChange={(ids) => setCreateForm((c) => ({ ...c, allowedProviders: ids }))}
                t={t}
                disabled={creating}
              />
            )}
            <TextField size="small" multiline minRows={2} label={t("settings.permissions.notes")} value={createForm.notes} onChange={(e) => setCreateForm((c) => ({ ...c, notes: e.target.value }))} />
            {formError ? <Alert severity="error">{formError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            {t("settings.permissions.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void submitCreate()} disabled={creating || !createForm.email || !createForm.password}>
            {creating ? t("settings.members.creating") : t("settings.permissions.create")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit permissions dialog */}
      <Dialog open={Boolean(editUser && editForm)} onClose={() => !saving && setEditUser(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 850 }}>{t("settings.permissions.editUser")}</DialogTitle>
        <DialogContent dividers>
          {editForm ? (
            <Stack spacing={1.5} sx={{ pt: 0.5 }}>
              <TextField size="small" label={t("settings.members.email")} value={editForm.email} onChange={(e) => setEditForm((c) => (c ? { ...c, email: e.target.value } : c))} />
              <TextField size="small" type="password" label={t("settings.permissions.newPassword")} placeholder={t("settings.permissions.passwordOptional")} value={editForm.password} onChange={(e) => setEditForm((c) => (c ? { ...c, password: e.target.value } : c))} />
              <TextField size="small" label={t("settings.members.username")} value={editForm.username} onChange={(e) => setEditForm((c) => (c ? { ...c, username: e.target.value } : c))} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                <FormControl size="small" fullWidth>
                  <InputLabel>{t("settings.members.role")}</InputLabel>
                  <Select label={t("settings.members.role")} value={editForm.role} onChange={(e) => setEditForm((c) => (c ? { ...c, role: e.target.value as "admin" | "user" } : c))}>
                    <MenuItem value="user">{t("settings.permissions.roleUser")}</MenuItem>
                    <MenuItem value="admin">{t("settings.permissions.roleAdmin")}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>{t("settings.members.status")}</InputLabel>
                  <Select label={t("settings.members.status")} value={editForm.status} onChange={(e) => setEditForm((c) => (c ? { ...c, status: e.target.value as "active" | "disabled" } : c))}>
                    <MenuItem value="active">{t("settings.permissions.statusActive")}</MenuItem>
                    <MenuItem value="disabled">{t("settings.permissions.statusDisabled")}</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settings.members.maxPermission")}</InputLabel>
                <Select
                  label={t("settings.members.maxPermission")}
                  value={editForm.maxPermission}
                  onChange={(e) => setEditForm((c) => (c ? { ...c, maxPermission: e.target.value as PermissionPresetId } : c))}
                >
                  {permissionPresets.map((preset) => (
                    <MenuItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField size="small" type="number" label={t("settings.permissions.concurrency")} value={editForm.concurrency} onChange={(e) => setEditForm((c) => (c ? { ...c, concurrency: e.target.value } : c))} />
              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                {t("settings.permissions.capabilitySwitches")}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <FormControlLabel control={<Checkbox checked={editForm.allowWrite} onChange={(e) => setEditForm((c) => (c ? { ...c, allowWrite: e.target.checked } : c))} />} label={t("settings.permissions.write")} />
                <FormControlLabel control={<Checkbox checked={editForm.allowNetwork} onChange={(e) => setEditForm((c) => (c ? { ...c, allowNetwork: e.target.checked } : c))} />} label={t("settings.permissions.network")} />
                <FormControlLabel control={<Checkbox checked={editForm.allowDangerBypass} onChange={(e) => setEditForm((c) => (c ? { ...c, allowDangerBypass: e.target.checked } : c))} />} label={t("settings.permissions.danger")} />
              </Stack>
              {editForm.role === "admin" ? (
                <Alert severity="info" variant="outlined">
                  {t("settings.permissions.adminAllRelays")}
                </Alert>
              ) : (
                <RelayAccessPicker
                  providers={providers}
                  selected={editForm.allowedProviders}
                  onChange={(ids) => setEditForm((c) => (c ? { ...c, allowedProviders: ids } : c))}
                  t={t}
                  disabled={saving}
                />
              )}
              <TextField size="small" multiline minRows={2} label={t("settings.permissions.notes")} value={editForm.notes} onChange={(e) => setEditForm((c) => (c ? { ...c, notes: e.target.value } : c))} />
              {editUser ? (
                <Alert severity="info" variant="outlined">
                  {t("settings.permissions.workspaceFixed")}: {editUser.workspaceRoot}
                </Alert>
              ) : null}
              {formError ? <Alert severity="error">{formError}</Alert> : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={() => setEditUser(null)} disabled={saving}>
            {t("settings.permissions.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void submitEdit()} disabled={saving}>
            {saving ? t("settings.permissions.saving") : t("settings.permissions.save")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Balance allocate dialog (Sub2API set/add/subtract) */}
      <Dialog open={Boolean(balanceUser)} onClose={() => !allocating && setBalanceUser(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 850 }}>{t("settings.members.allocateTitle")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            {balanceUser ? (
              <Alert severity="info" variant="outlined">
                {balanceUser.email} · {t("settings.members.balance")}: {Number(balanceUser.balance).toFixed(2)}
              </Alert>
            ) : null}
            <FormControl size="small" fullWidth>
              <InputLabel>{t("settings.permissions.balanceOp")}</InputLabel>
              <Select label={t("settings.permissions.balanceOp")} value={balanceOp} onChange={(e) => setBalanceOp(e.target.value as BalanceOp)}>
                <MenuItem value="add">{t("settings.permissions.balanceAdd")}</MenuItem>
                <MenuItem value="set">{t("settings.permissions.balanceSet")}</MenuItem>
                <MenuItem value="subtract">{t("settings.permissions.balanceSubtract")}</MenuItem>
              </Select>
            </FormControl>
            <TextField size="small" type="number" label={t("settings.permissions.amount")} value={balanceAmount} onChange={(e) => setBalanceAmount(e.target.value)} />
            <TextField size="small" label={t("settings.permissions.notes")} value={balanceNotes} onChange={(e) => setBalanceNotes(e.target.value)} />
            {formError ? <Alert severity="error">{formError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={() => setBalanceUser(null)} disabled={allocating}>
            {t("settings.permissions.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void submitBalance()} disabled={allocating}>
            {allocating ? t("settings.permissions.saving") : t("settings.members.allocate")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function presetLabel(id: PermissionPresetId): string {
  return permissionPresets.find((entry) => entry.id === id)?.label ?? id;
}

function RelayAccessPicker({
  providers,
  selected,
  onChange,
  t,
  disabled
}: {
  providers: ProviderConfig[];
  selected: string[];
  onChange: (ids: string[]) => void;
  t: TranslateFn;
  disabled?: boolean;
}) {
  const allIds = providers.map((p) => p.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id));
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {t("settings.permissions.allowedRelays")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("settings.permissions.allowedRelaysHint")}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75}>
          <Button
            size="small"
            variant="outlined"
            disabled={disabled || providers.length === 0}
            onClick={() => onChange(allIds)}
            sx={{ borderRadius: 999 }}
          >
            {t("settings.permissions.selectAllRelays")}
          </Button>
          <Button
            size="small"
            variant="text"
            disabled={disabled || selected.length === 0}
            onClick={() => onChange([])}
            sx={{ borderRadius: 999 }}
          >
            {t("settings.permissions.clearRelays")}
          </Button>
        </Stack>
      </Stack>
      <Stack
        spacing={0.75}
        sx={{
          maxHeight: 220,
          overflow: "auto",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          p: 1.25,
          bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(15,23,42,0.45)" : "rgba(248,250,252,0.9)")
        }}
      >
        {providers.length === 0 ? (
          <Alert severity="warning" variant="outlined">
            {t("settings.permissions.noProviders")}
          </Alert>
        ) : (
          providers.map((provider) => {
            const checked = selected.includes(provider.id);
            return (
              <Paper
                key={provider.id}
                variant="outlined"
                sx={{
                  px: 1,
                  py: 0.5,
                  borderRadius: 1.5,
                  borderColor: checked ? "primary.main" : "divider",
                  bgcolor: checked ? "action.selected" : "transparent"
                }}
              >
                <FormControlLabel
                  sx={{ m: 0, width: "100%", alignItems: "flex-start" }}
                  control={
                    <Checkbox
                      size="small"
                      disabled={disabled}
                      checked={checked}
                      onChange={(e) => {
                        onChange(
                          e.target.checked
                            ? [...selected, provider.id]
                            : selected.filter((id) => id !== provider.id)
                        );
                      }}
                    />
                  }
                  label={
                    <Box sx={{ pt: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {provider.name || provider.id}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
                        {provider.id}
                        {provider.kind ? ` · ${provider.kind}` : ""}
                        {provider.defaultModel ? ` · ${provider.defaultModel}` : ""}
                      </Typography>
                    </Box>
                  }
                />
              </Paper>
            );
          })
        )}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          size="small"
          color={selected.length ? "primary" : "default"}
          variant="outlined"
          label={t("settings.permissions.selectedRelays", { count: selected.length, total: providers.length })}
        />
        {allSelected ? <Chip size="small" color="success" label={t("settings.permissions.allRelaysSelected")} /> : null}
        {providers.length > 0 && selected.length === 0 ? (
          <Chip size="small" color="warning" variant="outlined" label={t("settings.permissions.noRelayAccess")} />
        ) : null}
      </Stack>
    </Stack>
  );
}

