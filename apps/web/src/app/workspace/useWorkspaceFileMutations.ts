import { useCallback } from "react";
import {
  copySshWorkspacePath,
  copyWorkspacePath,
  createSshWorkspaceDirectory,
  createSshWorkspaceFile,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteSshWorkspacePath,
  deleteWorkspacePath,
  renameSshWorkspacePath,
  renameWorkspacePath,
  type FsDirectoryEntry
} from "../../state/codexClient";

export type WorkspaceMode = "local" | "ssh";

type Deps = {
  token: string | null;
  threadId?: string | null;
  mode: WorkspaceMode;
  sshCommand: string;
  cwd: string;
  onError: (message: string) => void;
  onMutated: (parentPaths: string[]) => Promise<void> | void;
  openFilePath?: string | null;
  onOpenFileRemoved?: (path: string) => void;
  onOpenFileRenamed?: (source: string, destination: string) => void;
};

function joinChildPath(parent: string, name: string): string {
  const trimmedName = name.trim().replace(/[\\/]+$/, "");
  if (!trimmedName || trimmedName === "." || trimmedName === ".." || trimmedName.includes("..")) {
    throw new Error(`Invalid name: ${name}`);
  }
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  const trimmedParent = parent.replace(/[\\/]+$/, "");
  return `${trimmedParent}${separator}${trimmedName}`;
}

function parentOf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index <= 0) return normalized.slice(0, 1) === "/" ? "/" : normalized;
  if (/^[A-Za-z]:$/.test(normalized.slice(0, index))) return `${normalized.slice(0, index + 1)}`;
  return normalized.slice(0, index) || "/";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * VSCode 式资源浏览器变更操作：新建文件/文件夹、删除、重命名、复制、移动。
 * local 走 /api/workspace/* 直写端点；ssh 走 /api/ssh/* 等价物。
 * 调用后自动刷新受影响的父目录。
 */
export function useWorkspaceFileMutations(deps: Deps) {
  const { token, threadId, mode, sshCommand, cwd, onError, onMutated, openFilePath, onOpenFileRemoved, onOpenFileRenamed } = deps;

  const createFile = useCallback(async (parentPath: string, name: string) => {
    if (!token) throw new Error("Missing session token");
    const target = joinChildPath(parentPath, name);
    try {
      if (mode === "ssh") await createSshWorkspaceFile(token, sshCommand, target);
      else await createWorkspaceFile(token, { path: target, threadId: threadId ?? undefined, cwd });
      await onMutated([parentPath]);
      return target;
    } catch (error) {
      onError(errorText(error));
      throw error;
    }
  }, [token, threadId, mode, sshCommand, cwd, onError, onMutated]);

  const createFolder = useCallback(async (parentPath: string, name: string) => {
    if (!token) throw new Error("Missing session token");
    const target = joinChildPath(parentPath, name);
    try {
      if (mode === "ssh") await createSshWorkspaceDirectory(token, sshCommand, target);
      else await createWorkspaceDirectory(token, { path: target, recursive: true, threadId: threadId ?? undefined, cwd });
      await onMutated([parentPath, target]);
      return target;
    } catch (error) {
      onError(errorText(error));
      throw error;
    }
  }, [token, threadId, mode, sshCommand, cwd, onError, onMutated]);

  const removePaths = useCallback(async (paths: string[]) => {
    if (!token) throw new Error("Missing session token");
    if (paths.length === 0) return;
    const parents = [...new Set(paths.map(parentOf))];
    try {
      for (const path of paths) {
        if (mode === "ssh") await deleteSshWorkspacePath(token, sshCommand, path);
        else await deleteWorkspacePath(token, { path, threadId: threadId ?? undefined, cwd });
        if (openFilePath && (openFilePath === path || openFilePath.startsWith(`${path}/`) || openFilePath.startsWith(`${path}\\`))) {
          onOpenFileRemoved?.(openFilePath);
        }
      }
      await onMutated(parents);
    } catch (error) {
      onError(errorText(error));
      throw error;
    }
  }, [token, threadId, mode, sshCommand, cwd, onError, onMutated, openFilePath, onOpenFileRemoved]);

  const renamePath = useCallback(async (source: string, newName: string) => {
    if (!token) throw new Error("Missing session token");
    const parent = parentOf(source);
    const destination = joinChildPath(parent, newName);
    try {
      if (mode === "ssh") await renameSshWorkspacePath(token, sshCommand, source, destination);
      else await renameWorkspacePath(token, { source, destination, threadId: threadId ?? undefined, cwd });
      if (openFilePath && (openFilePath === source || openFilePath.startsWith(`${source}/`) || openFilePath.startsWith(`${source}\\`))) {
        onOpenFileRenamed?.(openFilePath, openFilePath === source ? destination : destination + openFilePath.slice(source.length));
      }
      await onMutated([parent]);
      return destination;
    } catch (error) {
      onError(errorText(error));
      throw error;
    }
  }, [token, threadId, mode, sshCommand, cwd, onError, onMutated]);

  const copyPath = useCallback(async (source: string, destination: string) => {
    if (!token) throw new Error("Missing session token");
    try {
      if (mode === "ssh") await copySshWorkspacePath(token, sshCommand, source, destination);
      else await copyWorkspacePath(token, { source, destination, threadId: threadId ?? undefined, cwd });
      await onMutated([parentOf(source), parentOf(destination)]);
      return destination;
    } catch (error) {
      onError(errorText(error));
      throw error;
    }
  }, [token, threadId, mode, sshCommand, cwd, onError, onMutated]);

  const movePath = useCallback(async (source: string, destinationDir: string) => {
    if (!token) throw new Error("Missing session token");
    const name = source.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    const destination = joinChildPath(destinationDir, name);
    if (destination === source) return source;
    try {
      if (mode === "ssh") await renameSshWorkspacePath(token, sshCommand, source, destination);
      else await renameWorkspacePath(token, { source, destination, threadId: threadId ?? undefined, cwd });
      await onMutated([parentOf(source), destinationDir]);
      return destination;
    } catch (error) {
      onError(errorText(error));
      throw error;
    }
  }, [token, threadId, mode, sshCommand, cwd, onError, onMutated]);

  return { createFile, createFolder, removePaths, renamePath, copyPath, movePath };
}

export type { FsDirectoryEntry };
export { joinChildPath, parentOf };
