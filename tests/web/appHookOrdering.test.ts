import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const HOOK_CALL = /\buse(?:Callback|Context|DeferredValue|Effect|Id|ImperativeHandle|InsertionEffect|LayoutEffect|Memo|Reducer|Ref|State|SyncExternalStore|Transition)\s*\(/;

test("App does not call React hooks after authentication early returns", () => {
  const appPath = join(import.meta.dir, "../../apps/web/src/App.tsx");
  const rootPath = join(import.meta.dir, "../../apps/web/src/shell/AppRoot.tsx");
  // AppRoot branch: once the auth shell lives in AppRoot.tsx, scan it with
  // its own boundary + explicit end marker (the legacy App.tsx anchors —
  // fetchSshDirectory / extractTurnIdFromRpcResult — do not exist there).
  if (existsSync(rootPath)) {
    const source = readFileSync(rootPath, "utf8");
    const boundary = source.indexOf('if (cliPrerequisiteScreenEnabled && !cliPrerequisitesComplete || authStatus !== "authenticated")');
    const end = source.indexOf("/* app-root-end */");
    expect(boundary).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(boundary);
    expect(source.slice(boundary, end)).not.toMatch(HOOK_CALL);
    return;
  }
  const source = readFileSync(appPath, "utf8");
  const legacyBoundary = 'if (authStatus === "checking")';
  const currentBoundary = 'if (cliPrerequisiteScreenEnabled && !cliPrerequisitesComplete || authStatus !== "authenticated")';
  const earlyReturn = source.includes(legacyBoundary) ? source.indexOf(legacyBoundary) : source.indexOf(currentBoundary);
  const legacyAppEnd = source.indexOf("\n}\n\nasync function fetchSshDirectory", earlyReturn);
  const postAppHelper = source.indexOf("function extractTurnIdFromRpcResult", earlyReturn);
  const currentAppEnd = postAppHelper >= 0 ? source.lastIndexOf("\n}", postAppHelper) : -1;
  const appEnd = legacyAppEnd >= 0 ? legacyAppEnd : currentAppEnd;

  expect(earlyReturn).toBeGreaterThan(0);
  expect(appEnd).toBeGreaterThan(earlyReturn);

  const lateAppBody = source.slice(earlyReturn, appEnd);
  expect(lateAppBody).not.toMatch(HOOK_CALL);
});
