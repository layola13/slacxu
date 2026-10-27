import { describe, expect, test } from "bun:test";
import {
  buildProjectDiscussionPlan,
  isForbiddenProjectModel,
  isTransientProjectTurnReadError,
  isUnsupportedProjectTurnListError,
  permanentProjectTurnErrorMessage,
  type ProjectDiscussionRoute
} from "../../apps/server/src/projectDiscussion.ts";

function route(
  id: string,
  providerId: string,
  groupId: string,
  model: string
): ProjectDiscussionRoute {
  return { id, providerId, groupId, model };
}

describe("Project discussion model policy", () => {
  test("blocks Fable 5 aliases regardless of casing or punctuation", () => {
    for (const model of [
      "FABLE-5",
      "fable_5",
      "claude-fable-5-thinking",
      "claude_fable-5-context-200k",
      "vendor/Fable 5 Context"
    ]) {
      expect(isForbiddenProjectModel(model)).toBe(true);
    }

    expect(isForbiddenProjectModel("fable-4.5")).toBe(false);
    expect(isForbiddenProjectModel("claude-opus-4-8")).toBe(false);
    expect(isForbiddenProjectModel(null)).toBe(false);
  });
});

describe("Project turn polling", () => {
  test("retries the empty rollout initialization race", () => {
    const message = "failed to read thread: thread-store internal error: failed to read session metadata at C:/codex/sessions/rollout-123.jsonl: rollout at C:/codex/sessions/rollout-123.jsonl is empty";
    expect(isTransientProjectTurnReadError(new Error(message))).toBe(true);
    expect(isTransientProjectTurnReadError({ code: -32603, message })).toBe(true);
  });

  test("retries an unmaterialized thread before its first user message", () => {
    expect(isTransientProjectTurnReadError({
      message: "thread 01a00aa9-4567-7371-87b5-9b060ed8a781 is not materialized yet; thread/turns/list is unavailable before first user message"
    })).toBe(true);
  });

  test("does not retry unrelated thread-store failures", () => {
    expect(isTransientProjectTurnReadError(new Error(
      "failed to read session metadata: invalid JSON in rollout-123.jsonl"
    ))).toBe(false);
    expect(isTransientProjectTurnReadError(new Error("thread not found"))).toBe(false);
    expect(isTransientProjectTurnReadError({ message: "thread abc is not materialized" })).toBe(false);
  });

  test("falls back to terminal events when turn listing is unsupported", () => {
    expect(isUnsupportedProjectTurnListError(new Error("list_turns is not supported yet"))).toBe(true);
    expect(isUnsupportedProjectTurnListError({ message: "thread/turns/list is not supported yet" })).toBe(true);
    expect(isUnsupportedProjectTurnListError(new Error("thread not found"))).toBe(false);
  });

  test("detects permanent relay authentication and quota failures", () => {
    expect(permanentProjectTurnErrorMessage({
      message: "Reconnecting... 1/100",
      additionalDetails: "unexpected status 403 Forbidden: {\"code\":\"INSUFFICIENT_BALANCE\"}"
    })).toContain("403 Forbidden");
    expect(permanentProjectTurnErrorMessage({
      additionalDetails: "unexpected status 401 Unauthorized"
    })).toContain("401 Unauthorized");
    expect(permanentProjectTurnErrorMessage("token quota is not enough")).toBe("token quota is not enough");
  });

  test("leaves transient upstream failures to the normal timeout policy", () => {
    expect(permanentProjectTurnErrorMessage({
      message: "Reconnecting... 2/100",
      additionalDetails: "unexpected status 503 Service Unavailable"
    })).toBeNull();
    expect(permanentProjectTurnErrorMessage({ message: "connection reset" })).toBeNull();
  });
});

describe("Project heterogeneous review planning", () => {
  test("orders peers by provider, group, then model diversity", () => {
    const plan = buildProjectDiscussionPlan([
      route("reviewer", "flux", "pro", "opus"),
      route("provider", "omniroute", "pro", "opus"),
      route("group", "flux", "free", "other"),
      route("model", "flux", "pro", "other")
    ], 4);

    expect(plan.byReviewer.reviewer?.map((pair) => pair.subjectId)).toEqual([
      "provider",
      "group",
      "model"
    ]);
    expect(plan.byReviewer.reviewer?.map((pair) => pair.score)).toEqual([100, 11, 1]);
  });

  test("allows a team whose routes are completely identical to skip peer review", () => {
    const plan = buildProjectDiscussionPlan([
      route("boss", "flux", "pro", "opus"),
      route("product", "FLUX", "PRO", "OPUS")
    ]);

    expect(plan.pairs).toEqual([]);
    expect(plan.heterogeneousPairCount).toBe(0);
  });

  test("gives each reviewer at most two heterogeneous peers", () => {
    const plan = buildProjectDiscussionPlan([
      route("boss", "flux", "pro", "opus"),
      route("same", "flux", "pro", "opus"),
      route("free", "omniroute", "opencode-free", "longcat-2.0-free"),
      route("qa", "flux", "qa", "small"),
      route("customer", "customer", "review", "reviewer")
    ]);

    for (const pairs of Object.values(plan.byReviewer)) {
      expect(pairs.length).toBeLessThanOrEqual(2);
      expect(pairs.every((pair) => pair.reasons.length > 0)).toBe(true);
    }
    expect(plan.pairs.some((pair) =>
      (pair.reviewerId === "boss" && pair.subjectId === "same")
      || (pair.reviewerId === "same" && pair.subjectId === "boss")
    )).toBe(false);
  });
});
