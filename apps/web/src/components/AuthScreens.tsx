import { useCallback, useEffect, useState, type ChangeEvent as ReactChangeEvent, type FormEvent as ReactFormEvent } from "react";
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useI18n } from "../i18n";
import { fetchCaptcha, fetchPublicAuthConfig } from "../state/codexClient";



export function AuthLoadingScreen() {
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        color: "text.primary"
      }}
    >
      <Stack spacing={2} alignItems="center">
        <CircularProgress size={30} />
        <Typography variant="body2" color="text.secondary">
          Checking session
        </Typography>
      </Stack>
    </Box>
  );
}

export function LoginScreen({
  error,
  submitting,
  onSubmit,
  onRegister,
  onLogin2fa
}: {
  error: string | null;
  submitting: boolean;
  onSubmit: (
    email: string,
    password: string,
    captcha?: { captchaId?: string; captchaAnswer?: string }
  ) => Promise<{ requires_2fa?: boolean; pendingToken?: string } | void>;
  onRegister?: (input: {
    email: string;
    password: string;
    username?: string;
    captchaId?: string;
    captchaAnswer?: string;
  }) => Promise<void>;
  onLogin2fa?: (pendingToken: string, totpCode: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register" | "2fa">("login");
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [captchaPrompt, setCaptchaPrompt] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [authConfig, setAuthConfig] = useState<{ registrationEnabled: boolean; captchaEnabled: boolean; totpEnabled: boolean }>({
    registrationEnabled: false,
    captchaEnabled: true,
    totpEnabled: true
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const refreshCaptcha = useCallback(async () => {
    try {
      const challenge = await fetchCaptcha();
      setCaptchaId(challenge.id);
      // Strip accidental XML prologues so inline SVG never renders as a black box.
      setCaptchaSvg(challenge.svg.replace(/^\s*<\?xml[^?]*\?>\s*/i, "").trim());
      setCaptchaPrompt(challenge.prompt ?? "");
      setCaptchaAnswer("");
    } catch {
      setCaptchaId("");
      setCaptchaSvg("");
      setCaptchaPrompt("");
      setCaptchaAnswer("");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setAuthConfig(await fetchPublicAuthConfig());
      } catch {
        /* keep defaults */
      }
      await refreshCaptcha();
    })();
  }, [refreshCaptcha]);

  const captchaPayload = authConfig.captchaEnabled
    ? { captchaId, captchaAnswer: captchaAnswer.trim() }
    : undefined;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        background: (theme: Theme) =>
          theme.palette.mode === "dark"
            ? "radial-gradient(circle at top, rgba(56,189,248,0.12), transparent 40%), #0b1220"
            : "radial-gradient(circle at top, rgba(14,165,233,0.12), transparent 40%), #f4f7fb"
      }}
    >
      <Box
        component="form"
        onSubmit={(event: ReactFormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void (async () => {
            setLocalError(null);
            try {
              if (mode === "2fa") {
                await onLogin2fa?.(pendingToken, totpCode.trim());
                return;
              }
              if (mode === "register") {
                await onRegister?.({
                  email: email.trim(),
                  password,
                  username: username.trim() || undefined,
                  captchaId: captchaPayload?.captchaId,
                  captchaAnswer: captchaPayload?.captchaAnswer
                });
                setMode("login");
                await refreshCaptcha();
                return;
              }
              const result = await onSubmit(email.trim(), password, captchaPayload);
              if (result?.requires_2fa && result.pendingToken) {
                setPendingToken(result.pendingToken);
                setMode("2fa");
                setTotpCode("");
                return;
              }
            } catch (err) {
              setLocalError(err instanceof Error ? err.message : String(err));
              setCaptchaAnswer("");
              void refreshCaptcha().catch(() => {});
            }
          })();
        }}
        sx={{
          width: "100%",
          maxWidth: 440,
          p: 3,
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: (theme: Theme) => (theme.palette.mode === "dark" ? "rgba(15,23,42,0.88)" : "rgba(255,255,255,0.92)"),
          backdropFilter: "blur(16px)",
          boxShadow: 8
        }}
      >
        <Stack spacing={2}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: 0 }}>
              codex-ultra
            </Typography>
            <Typography color="text.secondary">
              {mode === "register" ? t("auth.registerTitle") : mode === "2fa" ? t("auth.totpTitle") : t("auth.loginTitle")}
            </Typography>
          </Box>

          {(error || localError) && (
            <Alert severity="error" variant="outlined">
              {localError || error}
            </Alert>
          )}

          {mode === "2fa" ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {t("auth.totpHint")}
              </Typography>
              <TextField
                id="login-totp"
                size="small"
                label={t("auth.totpCode")}
                value={totpCode}
                onChange={(r: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setTotpCode(r.target.value)}
                inputProps={{ inputMode: "numeric", maxLength: 6, autoComplete: "one-time-code" }}
                autoFocus
              />
              <Button type="submit" variant="contained" disabled={submitting || totpCode.trim().length < 6} sx={{ borderRadius: 999, py: 1.1, fontWeight: 800 }}>
                {submitting ? t("auth.verifying") : t("auth.verify")}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setMode("login");
                  setPendingToken("");
                  setTotpCode("");
                  void refreshCaptcha();
                }}
              >
                {t("auth.backToLogin")}
              </Button>
            </>
          ) : (
            <>
              <TextField id="login-email" size="small" label={t("auth.email")} value={email} onChange={(r: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEmail(r.target.value)} autoComplete="username" required />
              <TextField
                id="login-password"
                size="small"
                type="password"
                label={t("auth.password")}
                value={password}
                onChange={(r: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setPassword(r.target.value)}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
              />
              {mode === "register" ? (
                <TextField id="login-username" size="small" label={t("auth.username")} value={username} onChange={(r: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setUsername(r.target.value)} />
              ) : null}

              {authConfig.captchaEnabled ? (
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      role="img"
                      aria-label={captchaPrompt ? t("auth.captchaAria", { prompt: captchaPrompt }) : t("auth.captcha")}
                      onClick={() => void refreshCaptcha()}
                      title={t("auth.refreshCaptcha")}
                      sx={{
                        flex: 1,
                        height: 72,
                        minWidth: 220,
                        borderRadius: 2,
                        overflow: "hidden",
                        border: "1px solid",
                        borderColor: "divider",
                        bgcolor: "#0f172a",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        position: "relative",
                        "& svg": {
                          display: "block",
                          width: "100%",
                          height: "100%",
                          maxWidth: 220,
                          maxHeight: 72
                        }
                      }}
                    >
                      {captchaSvg ? (
                        <Box sx={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: captchaSvg }} />
                      ) : null}
                      {!captchaSvg && captchaPrompt ? (
                        <Typography
                          variant="body2"
                          sx={{
                            position: "absolute",
                            inset: 0,
                            display: "grid",
                            placeItems: "center",
                            color: "#f8fafc",
                            fontWeight: 900,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            letterSpacing: 1
                          }}
                        >
                          {captchaPrompt}
                        </Typography>
                      ) : null}
                      {!captchaSvg && !captchaPrompt ? (
                        <Typography variant="caption" color="rgba(226,232,240,0.72)" sx={{ fontWeight: 800 }}>
                          {t("auth.refreshCaptcha")}
                        </Typography>
                      ) : null}
                    </Box>
                    <Button size="small" variant="outlined" onClick={() => void refreshCaptcha()} sx={{ borderRadius: 999, minWidth: 72 }}>
                      {t("auth.refreshCaptcha")}
                    </Button>
                  </Stack>
                  <TextField
                    id="login-captcha"
                    size="small"
                    label={t("auth.captcha")}
                    value={captchaAnswer}
                    onChange={(r: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCaptchaAnswer(r.target.value)}
                    required
                    placeholder={t("auth.captchaPlaceholder")}
                  />
                </Stack>
              ) : null}

              <Button type="submit" variant="contained" disabled={submitting} sx={{ borderRadius: 999, py: 1.1, fontWeight: 800 }}>
                {submitting ? t("auth.submitting") : mode === "register" ? t("auth.register") : t("auth.login")}
              </Button>

              {authConfig.registrationEnabled ? (
                <Button
                  size="small"
                  onClick={() => {
                    setMode((current: "login" | "register" | "2fa") => (current === "register" ? "login" : "register"));
                    setLocalError(null);
                    void refreshCaptcha();
                  }}
                >
                  {mode === "register" ? t("auth.haveAccount") : t("auth.needAccount")}
                </Button>
              ) : null}
            </>
          )}
        </Stack>
      </Box>
    </Box>
  );
}


















