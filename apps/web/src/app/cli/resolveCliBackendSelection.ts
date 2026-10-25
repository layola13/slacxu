import type { CliBackend, ProviderConfig } from "@codex-ui/shared";

export interface CliBackendSelectionInput {
  value: CliBackend;
  currentProviderId: string | null;
  currentGroupId: string | null;
  currentModel: string;
  providers: ProviderConfig[];
}

export interface CliBackendSelectionPatch {
  cliBackend: CliBackend;
  providerId: string | null;
  groupId?: string | null;
  model: string;
}

/**
 * Pure selection rule for switching the new-conversation CLI backend.
 * Keeps the provider/group/model linkage in one place so App.tsx only
 * forwards the current runtime selection and applies the returned patch.
 */
export function resolveCliBackendSelection(input: CliBackendSelectionInput): CliBackendSelectionPatch {
  const { value, currentProviderId, currentGroupId, currentModel, providers } = input;
  const isAgyRelay = Boolean(
    currentProviderId &&
      currentProviderId !== "agy-official" &&
      currentProviderId !== "grok-official" &&
      currentProviderId !== "pi-relay" &&
      currentProviderId !== "opencode-local" &&
      providers.some((provider) => provider.id === currentProviderId)
  );
  if (value === "agy") {
    return {
      cliBackend: "agy",
      providerId: isAgyRelay ? currentProviderId! : "agy-official",
      groupId: isAgyRelay ? (currentGroupId ?? null) : null,
      model: isAgyRelay && currentModel ? currentModel : "gemini-3.8-flash-high",
    };
  }
  if (value === "grok") {
    return { cliBackend: "grok", providerId: "grok-official", groupId: null, model: "grok-4.6" };
  }
  if (value === "pi") {
    return { cliBackend: "pi", providerId: "pi-relay", groupId: null, model: "pi-relay/default" };
  }
  if (value === "opencode" || value === "opencode-v2") {
    const provider = providers.find((entry) => entry.id === "opencode-local");
    const wantGroupId = value === "opencode-v2" ? "v2" : "v1";
    const group = provider?.groups?.find((entry) => entry.id === wantGroupId) ?? provider?.groups?.[0];
    const model =
      group?.models?.find((entry: string) => entry && entry !== "default") ||
      (provider?.defaultModel && provider.defaultModel !== "default" ? provider.defaultModel : null) ||
      "opencode/big-pickle";
    return { cliBackend: value, providerId: "opencode-local", groupId: group?.id ?? wantGroupId, model };
  }
  const managedProvider =
    currentProviderId === "agy-official" ||
    currentProviderId === "grok-official" ||
    currentProviderId === "pi-relay" ||
    currentProviderId === "opencode-local";
  return {
    cliBackend: value,
    providerId: managedProvider ? null : currentProviderId,
    model: managedProvider ? "" : currentModel,
  };
}
