import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Stack,
  Typography
} from "@mui/material";
import GavelIcon from "@mui/icons-material/Gavel";
import LogoutIcon from "@mui/icons-material/Logout";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import type { AuthSession, LegalPolicyBundle, LegalPolicyDocument, LegalPolicyLanguage } from "@codex-ui/shared";
import { fetchLegalPolicy } from "../state/codexClient";
import { MarkdownMessage } from "./MarkdownMessage";

type Props = {
  session: AuthSession;
  onAccept: (policy: LegalPolicyBundle) => Promise<void>;
  onLogout: () => void;
};

export function LegalConsentScreen({ session, onAccept, onLogout }: Props) {
  const [language, setLanguage] = useState<LegalPolicyLanguage>(session.legalConsent?.language ?? "cn");
  const [policy, setPolicy] = useState<LegalPolicyBundle | null>(null);
  const [openDocument, setOpenDocument] = useState<LegalPolicyDocument | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCn = language === "cn";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAcknowledged(false);
    void fetchLegalPolicy(session.token, language)
      .then((next) => {
        if (!cancelled) setPolicy(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [language, session.token]);

  const privacyDocument = useMemo(() => policy?.documents.find((document) => document.id === "privacy") ?? null, [policy]);
  const termsDocument = useMemo(() => policy?.documents.find((document) => document.id === "terms") ?? null, [policy]);
  const canAccept = Boolean(policy && acknowledged && !loading && !submitting);

  async function accept() {
    if (!policy || !canAccept) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAccept(policy);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setAcknowledged(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog
        open
        fullWidth
        maxWidth="sm"
        data-testid="legal-consent-screen"
        aria-labelledby="legal-consent-title"
        disableEscapeKeyDown
        slotProps={{
          backdrop: { sx: { bgcolor: "rgba(15, 23, 42, 0.52)" } },
          paper: { sx: { borderRadius: 2, backgroundImage: "none" } }
        }}
      >
        <DialogTitle id="legal-consent-title" sx={{ pb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <VerifiedUserIcon color="primary" />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography component="span" variant="h6" sx={{ fontWeight: 850, fontSize: 18 }}>
                {isCn ? "用户协议与隐私协议" : "Terms & Privacy"}
              </Typography>
              <Typography component="div" variant="caption" color="text.secondary">
                {isCn ? "首次使用前请确认" : "Confirmation required before first use"}
              </Typography>
            </Box>
            <Button size="small" variant={isCn ? "contained" : "text"} onClick={() => setLanguage("cn")}>中文</Button>
            <Button size="small" variant={!isCn ? "contained" : "text"} onClick={() => setLanguage("en")}>EN</Button>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {loading ? (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 120 }}><CircularProgress size={28} /></Stack>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {isCn
                  ? "请先查看用户协议和隐私协议。点击链接可打开完整内容。"
                  : "Please review the Terms of Use and Privacy Policy. Open either link to read the full document."}
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                {termsDocument ? <Link component="button" type="button" onClick={() => setOpenDocument(termsDocument)}>{isCn ? "用户协议" : "Terms of Use"}</Link> : null}
                {privacyDocument ? <Link component="button" type="button" onClick={() => setOpenDocument(privacyDocument)}>{isCn ? "隐私协议" : "Privacy Policy"}</Link> : null}
              </Stack>
              <FormControlLabel
                control={<Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} inputProps={{ "aria-label": isCn ? "我已阅读用户协议和隐私协议" : "I have read the Terms and Privacy Policy" }} />}
                label={isCn ? "我已经阅读并同意用户协议和隐私协议" : "I have read and agree to the Terms of Use and Privacy Policy"}
                sx={{ alignItems: "flex-start", m: 0 }}
              />
              {error ? <Alert severity="error" variant="outlined">{error}</Alert> : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button color="inherit" startIcon={<LogoutIcon />} onClick={onLogout} disabled={submitting}>
            {isCn ? "取消" : "Cancel"}
          </Button>
          <Button variant="contained" startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <GavelIcon />} onClick={() => void accept()} disabled={!canAccept}>
            {isCn ? "确定" : "Confirm"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(openDocument)} onClose={() => setOpenDocument(null)} fullWidth maxWidth="md" data-testid="legal-document-dialog">
        <DialogTitle>{openDocument?.title ?? (isCn ? "协议" : "Policy")}</DialogTitle>
        <DialogContent dividers sx={{ maxHeight: "min(72vh, 720px)", overflowY: "auto" }}>
          {openDocument ? <MarkdownMessage text={openDocument.content} /> : null}
        </DialogContent>
        <DialogActions><Button onClick={() => setOpenDocument(null)}>{isCn ? "关闭" : "Close"}</Button></DialogActions>
      </Dialog>
    </>
  );
}
