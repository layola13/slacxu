import { useCallback, useState, type Dispatch, type MutableRefObject } from "react";
import {
  fetchWorkspaceDirectory,
  fetchWorkspaceFile,
  parseFsDirectory,
  writeWorkspaceFile,
  type CodexSocketClient,
  type FsDirectoryEntry,
} from "../../state/codexClient";
import { fetchSshDirectory, fetchSshFile, writeSshFile } from "./sshUtils";
import { shouldCommitWorkspaceRequest, workspaceDirectoryCacheKey } from "../workspace/rightWorkspaceContext";
import { asRecord, decodeBase64Text, encodeBase64Text, formatErrorText } from "./appUtils";
import type { useOpenFileTabs } from "../workspace/useOpenFileTabs";
import type { WorkspaceMode } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState } from "../../state/codexClient";

export function useWorkspaceFiles(input: {
  state: Pick<ClientState, "token" | "activeThreadId">;
  client: CodexSocketClient;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  cwd: string;
  workspaceMode: WorkspaceMode;
  sshCommand: string;
  fileTabs: ReturnType<typeof useOpenFileTabs>;
  rightWorkspaceVisible: boolean;
  rightWorkspaceRequestEpochRef: MutableRefObject<number>;
  workspacePickerOpen: boolean;
}) {
  const {
    state,
    client,
    dispatch,
    cwd,
    workspaceMode,
    sshCommand,
    fileTabs,
    rightWorkspaceVisible,
    rightWorkspaceRequestEpochRef,
    workspacePickerOpen,
  } = input;
  const [fileDirectories, setFileDirectories] = useState<Record<string, FsDirectoryEntry[]>>({});
  const [workspacePickerLoadingKey, setWorkspacePickerLoadingKey] = useState<string | null>(null);
  const readDirectoryInContext = useCallback(
    async (path: string, mode: WorkspaceMode = workspaceMode, command: string = sshCommand, contextCwd: string = cwd) => {
      const cacheKey = workspaceDirectoryCacheKey(mode, command, path);
      const requestEpoch = rightWorkspaceRequestEpochRef.current;
      setWorkspacePickerLoadingKey(cacheKey);
      try {
        if (mode === "ssh") {
          if (!state.token) {
            throw new Error("Missing session token");
          }
          const result = await fetchSshDirectory(state.token, command, path);
          if (!shouldCommitWorkspaceRequest(requestEpoch, rightWorkspaceRequestEpochRef.current, rightWorkspaceVisible || workspacePickerOpen)) return;
          setFileDirectories((current: Record<string, FsDirectoryEntry[]>) => ({ ...current, [cacheKey]: parseFsDirectory(result, path) }));
          return;
        }
        if (!state.token) {
          throw new Error("Missing session token");
        }
        const result = await fetchWorkspaceDirectory(state.token, path, state.activeThreadId ?? undefined, contextCwd);
        if (!shouldCommitWorkspaceRequest(requestEpoch, rightWorkspaceRequestEpochRef.current, rightWorkspaceVisible || workspacePickerOpen)) return;
        setFileDirectories((current: Record<string, FsDirectoryEntry[]>) => ({ ...current, [cacheKey]: parseFsDirectory(result, path) }));
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      } finally {
        setWorkspacePickerLoadingKey((current: string | null) => (current === cacheKey ? null : current));
      }
    },
    [rightWorkspaceVisible, sshCommand, state.token, workspaceMode, workspacePickerOpen]
  );
  const readDirectory = useCallback((path: string) => readDirectoryInContext(path), [readDirectoryInContext]);

  const readFile = useCallback(
    async (path: string) => {
      fileTabs.openTab(path);
      try {
        const result = workspaceMode === "ssh"
          ? await fetchSshFile(state.token!, sshCommand, path)
          : await fetchWorkspaceFile(state.token!, path, state.activeThreadId ?? undefined, cwd).catch(() =>
              client.rpc("fs/readFile", {
                path,
                ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}),
                ...(cwd ? { cwd } : {})
              })
            );
        const record = asRecord(result);
        const dataBase64 = typeof record.dataBase64 === "string" ? record.dataBase64 : undefined;
        const content = typeof dataBase64 === "string"
          ? decodeBase64Text(dataBase64)
          : typeof record.content === "string"
            ? record.content
            : typeof record.text === "string"
              ? record.text
              : undefined;
        // A backend without fs/readFile answers `{}`; surface that instead of an empty editor.
        if (content === undefined) throw new Error(`Failed to read ${path}: the backend returned no file content`);
        fileTabs.applyTabContent(path, content);
      } catch (error) {
        fileTabs.markTabLoadFailed(path);
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, cwd, fileTabs, sshCommand, state.activeThreadId, state.token, workspaceMode]
  );

  const changeOpenFileContent = useCallback((content: string) => {
    fileTabs.changeTabContent(content);
  }, [fileTabs]);

  const saveOpenFile = useCallback(async () => {
    const current = fileTabs.openFile;
    if (!current || current.loading) {
      return;
    }
    const { path, content } = current;
    fileTabs.markTabSaving(path, true);
    try {
      if (workspaceMode === "ssh") await writeSshFile(state.token!, sshCommand, path, encodeBase64Text(content));
      else {
        try {
          await writeWorkspaceFile(state.token!, path, encodeBase64Text(content), state.activeThreadId ?? undefined, cwd);
        } catch {
          await client.rpc("fs/writeFile", {
            path,
            content,
            dataBase64: encodeBase64Text(content),
            ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}),
            ...(cwd ? { cwd } : {})
          });
        }
      }
      fileTabs.markTabSaved(path);
      const parentPath = path.slice(0, path.lastIndexOf("/")) || "/";
      if (fileDirectories[parentPath]) {
        await readDirectory(parentPath);
      }
    } catch (error) {
      fileTabs.markTabSaving(path, false);
      dispatch({ type: "error", message: formatErrorText(error) });
    }
  }, [client, cwd, fileDirectories, fileTabs, readDirectory, sshCommand, state.activeThreadId, state.token, workspaceMode]);
  return {
    fileDirectories,
    setFileDirectories,
    workspacePickerLoadingKey,
    setWorkspacePickerLoadingKey,
    readDirectoryInContext,
    readDirectory,
    readFile,
    changeOpenFileContent,
    saveOpenFile,
  };
}
