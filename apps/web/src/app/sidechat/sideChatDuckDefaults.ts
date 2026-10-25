/**
 * Side chat default route: embedded duck2api free channel
 * (provider `omniroute-free` / group `d2api` / model `gpt-6-luna`).
 *
 * New side chat tabs start on this route instead of inheriting the main
 * composer selection. Existing threads keep their persisted selection.
 * When the route is unavailable (provider/group/model missing from the
 * relay topology) the caller's selection passes through untouched.
 */

export const SIDE_CHAT_DUCK_PROVIDER_ID = "omniroute-free";
export const SIDE_CHAT_DUCK_GROUP_ID = "d2api";
export const SIDE_CHAT_DUCK_MODEL = "gpt-6-luna";
// Side chat runs on the mini agent (product direction); the duck route is
// served through the mini backend, not codex.
export const SIDE_CHAT_DUCK_CLI_BACKEND = "mini";

export interface SideChatRelayGroupLike {
  id?: string | null;
  kind?: string | null;
  models?: Array<string | null | undefined> | null;
}

export interface SideChatRelayProviderLike {
  id?: string | null;
  groups?: Array<SideChatRelayGroupLike | null | undefined> | null;
}

export interface SideChatSelectionLike {
  providerId?: string | null;
  groupId?: string | null;
  model?: string | null;
  cliBackend?: string | null;
}

/** True when the duck2api route exists with gpt-6-luna selectable. */
export function isSideChatDuckDefaultAvailable(
  providers: Array<SideChatRelayProviderLike | null | undefined> | null | undefined
): boolean {
  const provider = (providers ?? []).find((entry) => entry?.id === SIDE_CHAT_DUCK_PROVIDER_ID);
  const group = provider?.groups?.find(
    (entry) => entry?.id === SIDE_CHAT_DUCK_GROUP_ID && entry?.kind !== "image"
  );
  return Boolean(
    group && (group.models ?? []).some((model) => model?.trim() === SIDE_CHAT_DUCK_MODEL)
  );
}

/**
 * Override a fresh (no-thread) side chat selection with the duck2api route.
 * Returns the input unchanged when the route is unavailable.
 */
export function applySideChatDuckDefault<T extends SideChatSelectionLike>(
  selection: T,
  providers: Array<SideChatRelayProviderLike | null | undefined> | null | undefined
): T {
  if (!isSideChatDuckDefaultAvailable(providers)) return selection;
  return {
    ...selection,
    providerId: SIDE_CHAT_DUCK_PROVIDER_ID,
    groupId: SIDE_CHAT_DUCK_GROUP_ID,
    model: SIDE_CHAT_DUCK_MODEL,
    cliBackend: SIDE_CHAT_DUCK_CLI_BACKEND,
  };
}

/** Header display model for a fresh side chat tab. */
export function sideChatHeaderModel(
  fallbackModel: string,
  hasThread: boolean,
  providers: Array<SideChatRelayProviderLike | null | undefined> | null | undefined
): string {
  if (!hasThread && isSideChatDuckDefaultAvailable(providers)) return SIDE_CHAT_DUCK_MODEL;
  return fallbackModel;
}

export interface SideChatModelOption {
  value: string;
  label: string;
}

/** Model options from the duck2api group for the side chat picker. */
export function sideChatModelOptions(
  providers: Array<SideChatRelayProviderLike | null | undefined> | null | undefined
): SideChatModelOption[] {
  const provider = (providers ?? []).find((entry) => entry?.id === SIDE_CHAT_DUCK_PROVIDER_ID);
  const group = provider?.groups?.find(
    (entry) => entry?.id === SIDE_CHAT_DUCK_GROUP_ID && entry?.kind !== "image"
  );
  const models = (group?.models ?? []).filter(
    (model): model is string => typeof model === "string" && model.trim() !== ""
  );
  return [...new Set(models)].map((model) => ({ value: model, label: model }));
}

/**
 * Whether a side chat turn may carry `web_search`: only the duck2api route
 * understands it end-to-end (gateway canonical passthrough → embedded
 * channel). Other backends would receive an unknown param, so never send it
 * there.
 */
export function shouldSendSideChatWebSearch(
  tabWebSearch: boolean | null | undefined,
  selection: SideChatSelectionLike | null | undefined
): boolean {
  return tabWebSearch === true
    && selection?.providerId === SIDE_CHAT_DUCK_PROVIDER_ID
    && selection?.groupId === SIDE_CHAT_DUCK_GROUP_ID;
}
/**
 * Effective model for a side chat tab: explicit per-tab override wins,
 * then the duck default for fresh tabs, then the global model.
 */
export function resolveSideChatTabModel(
  tabOverride: string | null | undefined,
  globalModel: string,
  hasThread: boolean,
  providers: Array<SideChatRelayProviderLike | null | undefined> | null | undefined
): string {
  const override = tabOverride?.trim() ? tabOverride.trim() : "";
  if (override) return override;
  return sideChatHeaderModel(globalModel, hasThread, providers);
}
