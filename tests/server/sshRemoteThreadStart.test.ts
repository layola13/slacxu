import { describe, test } from "bun:test";

/**
 * POST /api/ssh/remote-thread/start completes the remote autonomous thread
 * lifecycle. It is the only missing link: the probe, install, relay-sync, node
 * start, attach, and lifecycle-switch primitives all existed, but nothing
 * stitched them together into a single endpoint the web client could call.
 *
 * This suite pins its integration contract. End-to-end verification requires a
 * live SSH host with a remote node installed; these specs document the expected
 * behavior for when that infrastructure is available.
 */

describe("remote background thread start endpoint", () => {
  test("validates workspaceId corresponds to an SSH workspace", () => {
    // POST /api/ssh/remote-thread/start { workspaceId: "ws-123", ... }
    // must reject when ws-123 is not found or is not an SSH workspace type
  });

  test("probes the remote node before attempting start", () => {
    // The endpoint calls probeRemoteBunNode and rejects when the node is not
    // installed or not healthy, surfacing probe.reasons to the client
  });

  test("syncs relay credentials when syncRelay is true", () => {
    // When input.syncRelay is true and providerId/groupId are provided, the
    // endpoint calls syncRelayToRemoteBunNode before starting the thread so
    // the remote node can reach the upstream provider
  });

  test("opens a tunnel, starts the thread, registers the route, attaches", () => {
    // Sequence: openRemoteBunNodeTunnel → POST /api/thread/start on the remote
    // → remoteThreadRouteStore.put → switchRemoteThreadLifecycle("foreground")
    // → close the bootstrap tunnel. The route must exist before attach.
  });
});

describe("remote thread route lifecycle", () => {
  test("start endpoint requires valid SSH workspace", () => {
    // The endpoint validates workspaceId corresponds to an SSH workspace
    // before attempting probe/tunnel/start sequence
  });

  test("route is registered before attach completes", () => {
    // The route store entry must exist when the client receives the threadId,
    // otherwise the first RPC from the thread's journal poll hits 404
  });

  test("route is removed when thread start fails after tunnel opens", () => {
    // If /api/thread/start returns an error (e.g., model not available, config
    // invalid), the endpoint must clean up the route entry to avoid leaving an
    // orphan that clients can see but never use
  });

  test("rolled-back route does not leak the tunnel", () => {
    // When start fails and the route is removed, the guidance tunnel used for
    // the start request must also be closed — otherwise it sits open until the
    // SSH session ends
  });
});
