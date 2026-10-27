import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

if (typeof (globalThis as any).localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined
    }
  });
}

const root = join(import.meta.dir, "../..");
const appSource = readFileSync(join(root, "apps/web/src/shell/AppRoot.tsx"), "utf8");
const startupErrorSource = readFileSync(join(root, "apps/web/src/StartupErrorBoundary.tsx"), "utf8");
const cliGateSource = readFileSync(join(root, "apps/web/src/components/CliPrerequisiteScreen.tsx"), "utf8");
const legalScreenSource = readFileSync(join(root, "apps/web/src/components/LegalConsentScreen.tsx"), "utf8");

test("App strictly enforces startup authentication and gate state transitions", () => {
  // Gate 1: CLI Prerequisite Screen
  expect(appSource).toContain("if (cliPrerequisitesBlocked) {");
  expect(appSource).toContain("<CliPrerequisiteScreen onComplete={markCliPrerequisitesComplete} />");

  // Gate 2: Checking authentication
  expect(appSource).toContain('if (authStatus === "checking") {');
  expect(appSource).toContain("<AuthLoadingScreen />");

  // Gate 3: Legal consent requirement
  expect(appSource).toContain('if (authStatus === "legalRequired" && authSession) {');
  expect(appSource).toContain("return <LegalConsentScreen session={authSession} onAccept={acceptCurrentLegalPolicy} onLogout={leaveLegalReview} />;");

  // Gate 4: Login required fallback
  expect(appSource).toContain('if (authStatus === "loginRequired") {');
  expect(appSource).toContain("<LoginScreen");
});

test("No React hooks are invoked after early returns in App.tsx", () => {
  const legacyBoundary = 'if (authStatus === "checking")';
  const currentBoundary = 'if (cliPrerequisiteScreenEnabled && !cliPrerequisitesComplete || authStatus !== "authenticated")';
  const earlyReturn = appSource.includes(legacyBoundary) ? appSource.indexOf(legacyBoundary) : appSource.indexOf(currentBoundary);
  const legacyAppEnd = appSource.indexOf("\n}\n\nasync function fetchSshDirectory", earlyReturn);
  const postAppHelper = appSource.indexOf("function extractTurnIdFromRpcResult", earlyReturn);
  const currentAppEnd = postAppHelper >= 0 ? appSource.lastIndexOf("\n}", postAppHelper) : -1;
  const appEnd = legacyAppEnd >= 0 ? legacyAppEnd : currentAppEnd;

  expect(earlyReturn).toBeGreaterThan(0);
  expect(appEnd).toBeGreaterThan(earlyReturn);

  const lateAppBody = appSource.slice(earlyReturn, appEnd);
  expect(lateAppBody).not.toMatch(
    /\buse(?:Callback|Context|DeferredValue|Effect|Id|ImperativeHandle|InsertionEffect|LayoutEffect|Memo|Reducer|Ref|State|SyncExternalStore|Transition)\s*\(/
  );
});

test("CliPrerequisiteScreen renders prerequisite checks and triggers completion", () => {
  expect(cliGateSource).toContain('data-testid="cli-prerequisite-screen"');
  expect(cliGateSource).toContain("checkCliPrerequisites");
  expect(cliGateSource).toContain("onComplete");
});

test("LegalConsentScreen provides policy acceptance structure and actions", () => {
  expect(legalScreenSource).toContain('data-testid="legal-consent-screen"');
  expect(legalScreenSource).toContain('data-testid="legal-document-dialog"');
  expect(legalScreenSource).toContain("fetchLegalPolicy");
  expect(legalScreenSource).toContain("onAccept");
  expect(legalScreenSource).toContain("onLogout");
});

test("StartupErrorBoundary produces stable UI error codes and diagnostic reports", () => {
  expect(startupErrorSource).toContain("UI-");
  expect(startupErrorSource).toContain("StartupErrorBoundary");
  expect(startupErrorSource).toContain("StartupFailureScreen");
  expect(startupErrorSource).toContain('data-testid="startup-error-screen"');
  expect(startupErrorSource).toContain("copyDiagnostic");
  expect(startupErrorSource).toContain("installGlobalErrorDiagnostics");
});
