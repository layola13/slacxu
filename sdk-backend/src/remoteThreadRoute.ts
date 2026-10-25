/** Remote thread route record (R2: owned by the SDK).
 *
 * The route shape the host's remoteThreadRouteStore persists and
 * the Codex backend's remote bridges consume. Pure data.
 */
import type { CliBackend } from "@codex-ui/shared";

export type RemoteThreadRoute = {
  threadId: string;
  command: string;
  cwd: string;
  remotePort: number;
  lifecycleMode: "foreground" | "background";
  cliBackend: CliBackend;
  eventCursor: number;
  createdAt: number;
  updatedAt: number;
};
