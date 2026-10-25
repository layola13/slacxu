import type { AgentProjectMember } from "@codex-ui/shared";

export const PROJECT_DISCUSSION_ERROR_CODES = {
  RUNNING: "CUX-PROJECT-DISCUSSION-001",
  NO_HETEROGENEOUS_ROUTES: "CUX-PROJECT-DISCUSSION-002",
  TIMEOUT: "CUX-PROJECT-DISCUSSION-003",
  UPSTREAM: "CUX-PROJECT-UPSTREAM-001",
  FORBIDDEN_MODEL: "CUX-PROJECT-MODEL-001"
} as const;

export class ProjectDiscussionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "ProjectDiscussionError";
  }
}

export type ProjectDiscussionRoute = Pick<
  AgentProjectMember,
  "id" | "providerId" | "groupId" | "model"
>;

export type ProjectDiscussionPairReason = "provider" | "group" | "model";

export type ProjectDiscussionPair = {
  reviewerId: string;
  subjectId: string;
  reasons: ProjectDiscussionPairReason[];
  score: number;
};

export type ProjectDiscussionPlan = {
  pairs: ProjectDiscussionPair[];
  byReviewer: Record<string, ProjectDiscussionPair[]>;
  heterogeneousPairCount: number;
};

/**
 * Fable 5 is intentionally unavailable for Project discussions. Normalize
 * punctuation and casing so aliases such as `claude_fable-5-thinking` cannot
 * bypass the policy.
 */
export function isForbiddenProjectModel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("fable5");
}

export function forbiddenProjectModelMessage(model: string): string {
  return `${PROJECT_DISCUSSION_ERROR_CODES.FORBIDDEN_MODEL}: Project model is disabled (Fable 5): ${model}`;
}

export function isTransientProjectTurnReadError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);
  return /failed to read session metadata[\s\S]*rollout[\s\S]*is empty/i.test(message)
    || /^thread \S+ is not materialized yet; thread\/turns\/list is unavailable before first user message$/i.test(message);
}

export function isUnsupportedProjectTurnListError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);
  return /^(?:list_turns|thread\/turns\/list) is not supported yet$/i.test(message);
}

export function permanentProjectTurnErrorMessage(error: unknown): string | null {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const details = [record.additionalDetails, record.message, error]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(": ");
  if (!details) return null;
  return /unexpected status (?:401 Unauthorized|403 Forbidden)/i.test(details)
    || /INSUFFICIENT_BALANCE|insufficient account balance|token quota is not enough|insufficient (?:token )?quota|余额不足|配额不足/i.test(details)
    ? details
    : null;
}

export function assertProjectModelsAllowed(
  agents: ReadonlyArray<Pick<AgentProjectMember, "model" | "name">>
): void {
  const forbidden = agents.find((agent) => isForbiddenProjectModel(agent.model));
  if (forbidden) {
    throw new ProjectDiscussionError(
      PROJECT_DISCUSSION_ERROR_CODES.FORBIDDEN_MODEL,
      forbiddenProjectModelMessage(forbidden.model),
      400
    );
  }
}

function routeValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function pairFor(reviewer: ProjectDiscussionRoute, subject: ProjectDiscussionRoute): ProjectDiscussionPair {
  const reasons: ProjectDiscussionPairReason[] = [];
  if (routeValue(reviewer.providerId) !== routeValue(subject.providerId)) reasons.push("provider");
  if (routeValue(reviewer.groupId) !== routeValue(subject.groupId)) reasons.push("group");
  if (routeValue(reviewer.model) !== routeValue(subject.model)) reasons.push("model");
  // Provider diversity is the strongest signal, followed by group and model.
  const score = reasons.reduce((total, reason) => total + (reason === "provider" ? 100 : reason === "group" ? 10 : 1), 0);
  return { reviewerId: reviewer.id, subjectId: subject.id, reasons, score };
}

/**
 * Build a deterministic peer-review plan. Every reviewer receives up to two
 * peers, preferring a different provider, then a different group, then a
 * different model. The plan is deliberately pure so it can be validated before
 * any Codex turn is started and exercised without a live relay.
 */
export function buildProjectDiscussionPlan(
  routes: ReadonlyArray<ProjectDiscussionRoute>,
  maxPeers = 2
): ProjectDiscussionPlan {
  const uniqueRoutes = routes.filter((route, index) => route.id.trim() && routes.findIndex((entry) => entry.id === route.id) === index);
  const byReviewer: Record<string, ProjectDiscussionPair[]> = {};
  const pairs: ProjectDiscussionPair[] = [];
  const limit = Math.max(1, Math.min(4, Math.floor(maxPeers) || 2));

  for (const reviewer of uniqueRoutes) {
    const candidates = uniqueRoutes
      .filter((subject) => subject.id !== reviewer.id)
      .map((subject) => pairFor(reviewer, subject))
      // A challenge turn must have a concrete cross-route purpose. Keeping
      // identical routes in the plan would wake a reviewer only to restate
      // the same view and would make the heterogeneous phase misleading.
      .filter((pair) => pair.reasons.length > 0)
      .sort((left, right) => right.score - left.score || left.subjectId.localeCompare(right.subjectId))
      .slice(0, limit);
    byReviewer[reviewer.id] = candidates;
    pairs.push(...candidates);
  }

  const heterogeneousPairCount = pairs.filter((pair) => pair.reasons.length > 0).length;
  return { pairs, byReviewer, heterogeneousPairCount };
}

export function assertProjectDiscussionPlan(plan: ProjectDiscussionPlan): void {
  if (plan.heterogeneousPairCount === 0) {
    throw new ProjectDiscussionError(
      PROJECT_DISCUSSION_ERROR_CODES.NO_HETEROGENEOUS_ROUTES,
      `${PROJECT_DISCUSSION_ERROR_CODES.NO_HETEROGENEOUS_ROUTES}: at least two members must use different providers, groups, or models`,
      409
    );
  }
}

export function discussionRouteLabel(route: ProjectDiscussionRoute): string {
  const provider = route.providerId?.trim() || "inherit";
  const group = route.groupId?.trim() || "default";
  const model = route.model?.trim() || "default model";
  return `${provider}/${group}/${model}`;
}
