export type RemoteTurnErrorKind = "incompleteToolArguments" | "relayUnauthorized" | "officialRefreshRevoked" | "opencodeClientRestricted" | null;

export function classifyRemoteTurnError(message: string): RemoteTurnErrorKind {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("incomplete_function_call_arguments")
    || normalized.includes("function_call arguments json parse error")
    || normalized.includes("unexpected end of data")
    || (normalized.includes("stream disconnected before completion") && normalized.includes("function_call"))
    || normalized.includes("remote model stream ended before tool arguments were complete")
  ) {
    return "incompleteToolArguments";
  }
  if (
    normalized.includes("cux-rpc-auth-ssh-001")
    || normalized.includes("cux-rpc-auth-remote-bun-001")
    || normalized.includes("unauthorized relay gateway request")
    || normalized.includes("upstream unauthorized")
    || /(?:^|\b)(?:401\s+)?unauthorized(?:\b|$)/i.test(message)
  ) {
    return "relayUnauthorized";
  }
  if (
    normalized.includes("refresh token was revoked")
    || normalized.includes("refresh_token_revoked")
    || normalized.includes("your access token could not be refreshed because your refresh token was revoked")
    || (normalized.includes("access token could not be refreshed") && normalized.includes("sign in again"))
  ) {
    return "officialRefreshRevoked";
  }
  if (
    normalized.includes("opencode's free tier can only be used in opencode")
    || (normalized.includes("missingsessionid") && normalized.includes("opencode"))
  ) {
    return "opencodeClientRestricted";
  }
  return null;
}
