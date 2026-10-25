import type { JsonValue } from "@codex-ui/shared";

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

type ServerRequestLike = {
  method: string;
  params?: JsonValue;
};

const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "execCommandApproval",
  "applyPatchApproval"
]);

export function isApprovalServerRequest(request: ServerRequestLike): boolean {
  return APPROVAL_METHODS.has(request.method);
}

export function isUserInputServerRequest(request: ServerRequestLike): boolean {
  return request.method === "item/tool/requestUserInput";
}

export function buildServerRequestDecisionResponse(
  method: string | undefined,
  params: JsonValue | undefined,
  decision: ApprovalDecision
): JsonValue {
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: legacyReviewDecision(decision) };
  }
  if (method === "item/permissions/requestApproval") {
    if (decision === "accept" || decision === "acceptForSession") {
      const requested = asRecord(asRecord(params).permissions);
      const permissions: Record<string, JsonValue> = {};
      if (requested.network != null) permissions.network = requested.network as JsonValue;
      if (requested.fileSystem != null) permissions.fileSystem = requested.fileSystem as JsonValue;
      return { permissions, scope: decision === "acceptForSession" ? "session" : "turn" };
    }
    return { permissions: {}, scope: "turn" };
  }
  return { decision };
}

function legacyReviewDecision(decision: ApprovalDecision): string {
  switch (decision) {
    case "accept":
      return "approved";
    case "acceptForSession":
      return "approved_for_session";
    case "decline":
      return "denied";
    case "cancel":
      return "abort";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
