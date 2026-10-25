export type WorkspaceDirectoryMode = "local" | "ssh";

export type ConversationWorkspaceMetadata = {
  workspaceMode?: WorkspaceDirectoryMode;
  sshCommand?: string;
  sshCwd?: string;
  cwd?: string;
  additionalRoots?: string[];
};

type ConversationWorkspaceMetadataWithId = ConversationWorkspaceMetadata & { id: string };

export function conversationWorkspaceMetadata(
  threadId: string | null,
  visibleThreads: readonly ConversationWorkspaceMetadataWithId[],
  catalogThreads: readonly ConversationWorkspaceMetadataWithId[]
): ConversationWorkspaceMetadata | undefined {
  if (!threadId) return undefined;
  const visible = visibleThreads.find((thread) => thread.id === threadId);
  const catalog = catalogThreads.find((thread) => thread.id === threadId);
  if (!visible && !catalog) return undefined;
  if (visible?.workspaceMode === "local") {
    return { workspaceMode: "local", cwd: visible.cwd ?? catalog?.cwd, additionalRoots: visible.additionalRoots ?? catalog?.additionalRoots ?? [] };
  }
  if (catalog?.workspaceMode === "local" && !visible?.workspaceMode && !visible?.sshCommand) {
    return { workspaceMode: "local", cwd: visible?.cwd ?? catalog.cwd, additionalRoots: visible?.additionalRoots ?? catalog.additionalRoots ?? [] };
  }
  return {
    workspaceMode: visible?.workspaceMode ?? catalog?.workspaceMode,
    sshCommand: visible?.sshCommand ?? catalog?.sshCommand,
    sshCwd: visible?.sshCwd ?? catalog?.sshCwd,
    cwd: visible?.cwd ?? catalog?.cwd,
    additionalRoots: visible?.additionalRoots ?? catalog?.additionalRoots ?? []
  };
}

export function workspaceDirectoryCacheKey(mode: WorkspaceDirectoryMode, sshCommand: string, path: string): string {
  return mode === "ssh" ? `ssh:${sshCommand.trim()}:${path}` : path;
}

export function projectWorkspaceDirectories<T>(
  directories: Record<string, T>,
  mode: WorkspaceDirectoryMode,
  sshCommand: string
): Record<string, T> {
  if (mode === "local") {
    return Object.fromEntries(Object.entries(directories).filter(([key]) => !key.startsWith("ssh:")));
  }
  const prefix = `ssh:${sshCommand.trim()}:`;
  return Object.fromEntries(
    Object.entries(directories)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value])
  );
}

export function shouldCommitWorkspaceRequest(startEpoch: number, currentEpoch: number, visible: boolean): boolean {
  return visible && startEpoch === currentEpoch;
}
