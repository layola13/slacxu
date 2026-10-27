import { expect, test } from "bun:test";
import { resolveEffectiveTurnCliBackend } from "../../apps/web/src/app/cli/resolveEffectiveTurnCliBackend";
import { resolveCliBackendSelection } from "../../apps/web/src/app/cli/resolveCliBackendSelection";
import { resolveCliInstallationKind } from "../../apps/web/src/app/cli/useCliInstallations";
import { resolveUsageBackend } from "../../apps/web/src/app/cli/cliTogglePolicy";

test("effective turn backend keeps opencode-v2 instead of collapsing to v1 via the provider", () => {
  // The opencode-local provider id is shared by both generations; a v2
  // current/thread selection must win over the v1 provider catch.
  expect(resolveEffectiveTurnCliBackend({
    currentBackend: "opencode-v2",
    threadBackend: null,
    resolvedProviderId: "opencode-local",
    fallback: "mini",
  })).toBe("opencode-v2");
  expect(resolveEffectiveTurnCliBackend({
    currentBackend: null,
    threadBackend: "opencode-v2",
    resolvedProviderId: "opencode-local",
    fallback: "mini",
  })).toBe("opencode-v2");
  // v1 keeps resolving to v1, including via the shared provider alone.
  expect(resolveEffectiveTurnCliBackend({
    currentBackend: "opencode",
    threadBackend: null,
    resolvedProviderId: null,
    fallback: "mini",
  })).toBe("opencode");
  expect(resolveEffectiveTurnCliBackend({
    currentBackend: null,
    threadBackend: null,
    resolvedProviderId: "opencode-local",
    fallback: "mini",
  })).toBe("opencode");
});

test("backend selection gives opencode-v2 the v2 linkage and v1 the v1 linkage", () => {
  const patch = resolveCliBackendSelection({
    value: "opencode-v2",
    currentProviderId: "some-relay",
    currentGroupId: null,
    currentModel: "whatever",
    providers: [],
  });
  expect(patch).toEqual({
    cliBackend: "opencode-v2",
    providerId: "opencode-local",
    groupId: "v2",
    model: "opencode/big-pickle",
  });
  const v1patch = resolveCliBackendSelection({
    value: "opencode",
    currentProviderId: "some-relay",
    currentGroupId: null,
    currentModel: "whatever",
    providers: [],
  });
  expect(v1patch).toEqual({
    cliBackend: "opencode",
    providerId: "opencode-local",
    groupId: "v1",
    model: "opencode/big-pickle",
  });
});

test("installation kind and usage attribution resolve opencode-v2 to itself", () => {
  expect(resolveCliInstallationKind("opencode-v2")).toBe("opencode-v2");
  expect(resolveCliInstallationKind("opencode")).toBe("opencode");
  expect(resolveUsageBackend("opencode-v2")).toBe("opencode-v2");
});
