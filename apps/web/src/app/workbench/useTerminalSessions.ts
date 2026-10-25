import { useCallback, useState, type Dispatch } from "react";
import type { JsonValue } from "@codex-ui/shared";
import type { PtyTerminalSession, TerminalSession } from "../../state/codexClient";
import { appendBoundedTerminalOutput, asRecord, encodeBase64Text, formatErrorText } from "./appUtils";
import { addWorkspaceRpcMetadata } from "./sshUtils";
import { detectInteractiveFullscreenCommand } from "../../components/TerminalConsole";
import type { WorkspaceMode } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useTerminalSessions(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  activeWorkspaceMode: WorkspaceMode;
  activeWorkspaceCwd: string;
  activeWorkspaceSshCommand: string;
  activeWorkspaceSshCwd: string;
  activeProviderId: string | null;
  activeGroupId: string | null;
}) {
  const { state, dispatch, client, t, activeWorkspaceMode, activeWorkspaceCwd, activeWorkspaceSshCommand, activeWorkspaceSshCwd, activeProviderId, activeGroupId } = input;
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [ptyTerminals, setPtyTerminals] = useState<PtyTerminalSession[]>([]);
  const [ptyFocusTerminalId, setPtyFocusTerminalId] = useState<string | null>(null);

  const appendTerminalOutput = useCallback((processId: string, output: string) => {
    setTerminalSessions((current: TerminalSession[]) =>
      current.map((session: TerminalSession) => (session.processId === processId ? { ...session, output: appendBoundedTerminalOutput(session.output, output) } : session))
    );
  }, []);

  const createPtyTerminal = useCallback(
    async (terminalCwd: string, size: { rows: number; cols: number }, command?: string[]): Promise<string | null> => {
      try {
        const params: Record<string, JsonValue> = {
          cwd: terminalCwd,
          cols: size.cols,
          rows: size.rows
        };
        if (command && command.length > 0) params.command = command;
        if (state.activeThreadId) params.threadId = state.activeThreadId;
        const result = asRecord(await client.rpc("terminal/create", params));
        const terminalId = typeof result.id === "string" ? result.id : null;
        if (!terminalId) {
          throw new Error("Terminal backend did not return an id");
        }
        const entry: PtyTerminalSession = {
          terminalId,
          cwd: typeof result.cwd === "string" ? result.cwd : terminalCwd,
          cols: typeof result.cols === "number" ? result.cols : size.cols,
          rows: typeof result.rows === "number" ? result.rows : size.rows,
          status: "running",
          createdAt: typeof result.createdAt === "number" ? result.createdAt : Date.now()
        };
        setPtyTerminals((current: PtyTerminalSession[]) => [entry, ...current]);
        return terminalId;
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
        return null;
      }
    },
    [client, state.activeThreadId]
  );

  const runTerminalCommand = useCallback(
    async (command: string, commandCwd: string, size: { rows: number; cols: number }) => {
      const trimmed = command.trim();
      if (!trimmed) {
        return;
      }
      // Fullscreen TUI commands (top/vim/codex/...) can never work on the
      // transcript track: command/exec has no controlling terminal and the
      // transcript strips every CSI cursor-addressing sequence, so they
      // degrade into endless scrolling. Route them to a resident PTY
      // (xterm.js renders alt-screen natively) or refuse over SSH where no
      // local PTY can reach the remote host — orca's `unsupported_over_ssh`
      // policy for host-interactive commands.
      const fullscreen = detectInteractiveFullscreenCommand(trimmed);
      if (fullscreen) {
        if (activeWorkspaceMode === "ssh") {
          dispatch({
            type: "error",
            message: `“${fullscreen}”需要交互式终端：在 transcript 里跑只会满屏滚动刷屏。SSH 下请用 ssh 直连到远端运行，或切回本地工作区后点终端 + 键开交互式 shell。`
          });
          return;
        }
        const terminalId = await createPtyTerminal(commandCwd, size);
        if (!terminalId) return;
        setPtyFocusTerminalId(terminalId);
        try {
          // `\r` is Enter for every PTY: POSIX ttys map it to `\n` (ICRNL),
          // while Windows PowerShell/cmd under winpty/ConPTY ignore a bare `\n`.
          await client.rpc("terminal/write", { terminalId, data: `${trimmed}\r` });
        } catch (error) {
          dispatch({ type: "error", message: formatErrorText(error) });
        }
        return;
      }
      const processId = `term-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setTerminalSessions((current: TerminalSession[]) => [
        {
          processId,
          command: trimmed,
          cwd: commandCwd,
          workspaceMode: activeWorkspaceMode,
          ...(activeWorkspaceMode === "ssh" ? { sshCommand: activeWorkspaceSshCommand } : {}),
          ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}),
          ...(activeWorkspaceMode === "ssh" && activeProviderId ? { providerId: activeProviderId } : {}),
          ...(activeWorkspaceMode === "ssh" && activeGroupId ? { groupId: activeGroupId } : {}),
          output: `$ ${trimmed}
`,
          status: "running",
          rows: size.rows,
          cols: size.cols
        },
        ...current
      ]);
      try {
        // Cross-platform transcript exec (orca parity): local Windows hosts
        // have no /bin/bash — run through PowerShell. SSH workspaces stay on
        // the remote POSIX shell (typical Linux remote).
        const isWindowsCwd = /^[a-zA-Z]:[\\/]/.test(commandCwd);
        const isWindowsClient = typeof navigator !== "undefined"
          && (/Win/i.test(navigator.platform ?? "") || /Windows/i.test(navigator.userAgent ?? ""));
        const usePowerShell = activeWorkspaceMode !== "ssh" && (isWindowsCwd || isWindowsClient);
        const commandParams: Record<string, JsonValue> = {
          processId,
          command: usePowerShell
            ? ["powershell.exe", "-NoLogo", "-NoProfile", "-Command", trimmed]
            : ["/bin/bash", "-lc", trimmed],
          cwd: commandCwd,
          tty: true,
          streamStdin: true,
          streamStdoutStderr: true,
          size: { rows: size.rows, cols: size.cols }
        };
        addWorkspaceRpcMetadata(commandParams, activeWorkspaceMode, activeWorkspaceSshCommand, commandCwd, activeProviderId, activeGroupId);
        if (state.activeThreadId) commandParams.threadId = state.activeThreadId;
        const result = await client.rpc("command/exec", commandParams);
        const record = asRecord(result);
        const exitCode = typeof record.exitCode === "number" ? record.exitCode : undefined;
        const stdout = typeof record.stdout === "string" ? record.stdout : "";
        const stderr = typeof record.stderr === "string" ? record.stderr : "";
        setTerminalSessions((current: TerminalSession[]) =>
          current.map((session: TerminalSession) =>
            session.processId === processId
              ? {
                  ...session,
                  output: appendBoundedTerminalOutput(session.output, `${stdout}${stderr}`),
                  status: session.status === "terminated" ? "terminated" : exitCode === 0 ? "completed" : "failed",
                  exitCode
                }
              : session
          )
        );
      } catch (error) {
        appendTerminalOutput(processId, `
${formatErrorText(error)}
`);
        setTerminalSessions((current: TerminalSession[]) => current.map((session: TerminalSession) => (session.processId === processId ? { ...session, status: "failed" } : session)));
      }
    },
    [activeGroupId, activeProviderId, activeWorkspaceMode, activeWorkspaceSshCommand, appendTerminalOutput, client, createPtyTerminal, state.activeThreadId]
  );

  const writeTerminalInput = useCallback(
    async (processId: string, input: string) => {
      try {
        const session = terminalSessions.find((entry: TerminalSession) => entry.processId === processId);
        const params: Record<string, JsonValue> = { processId, deltaBase64: encodeBase64Text(input) };
        if (session?.threadId) params.threadId = session.threadId;
        if (session?.providerId) params.providerId = session.providerId;
        if (session?.groupId) params.groupId = session.groupId;
        addWorkspaceRpcMetadata(
          params,
          session?.workspaceMode ?? "local",
          session?.sshCommand ?? "",
          session?.cwd ?? "",
          session?.providerId,
          session?.groupId
        );
        await client.rpc("command/exec/write", params);
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, terminalSessions]
  );

  const terminateTerminal = useCallback(
    async (processId: string) => {
      try {
        const session = terminalSessions.find((entry: TerminalSession) => entry.processId === processId);
        const params: Record<string, JsonValue> = { processId };
        if (session?.threadId) params.threadId = session.threadId;
        addWorkspaceRpcMetadata(params, session?.workspaceMode ?? "local", session?.sshCommand ?? "", session?.cwd ?? "", session?.providerId, session?.groupId);
        await client.rpc("command/exec/terminate", params);
        setTerminalSessions((current: TerminalSession[]) => current.map((session: TerminalSession) => (session.processId === processId ? { ...session, status: "terminated" } : session)));
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, terminalSessions]
  );

  const resizeTerminal = useCallback(
    async (processId: string, size: { rows: number; cols: number }) => {
      try {
        const session = terminalSessions.find((entry: TerminalSession) => entry.processId === processId);
        const params: Record<string, JsonValue> = { processId, size };
        if (session?.threadId) params.threadId = session.threadId;
        addWorkspaceRpcMetadata(params, session?.workspaceMode ?? "local", session?.sshCommand ?? "", session?.cwd ?? "", session?.providerId, session?.groupId);
        await client.rpc("command/exec/resize", params);
        setTerminalSessions((current: TerminalSession[]) =>
          current.map((session: TerminalSession) => (session.processId === processId ? { ...session, rows: size.rows, cols: size.cols } : session))
        );
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, terminalSessions]
  );

  const writePtyTerminal = useCallback(
    async (terminalId: string, data: string) => {
      try {
        await client.rpc("terminal/write", { terminalId, data });
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client]
  );

  const killPtyTerminal = useCallback(
    async (terminalId: string) => {
      try {
        await client.rpc("terminal/kill", { terminalId });
        setPtyTerminals((current: PtyTerminalSession[]) =>
          current.map((entry: PtyTerminalSession) => (entry.terminalId === terminalId ? { ...entry, status: "exited" } : entry))
        );
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client]
  );

  const forgetPtyTerminal = useCallback(
    async (terminalId: string) => {
      try {
        await client.rpc("terminal/forget", { terminalId });
      } catch {
        // Forgetting a dead record is best-effort.
      }
      setPtyTerminals((current: PtyTerminalSession[]) => current.filter((entry: PtyTerminalSession) => entry.terminalId !== terminalId));
    },
    [client]
  );

  const resizePtyTerminal = useCallback(
    async (terminalId: string, size: { rows: number; cols: number }) => {
      try {
        await client.rpc("terminal/resize", { terminalId, cols: size.cols, rows: size.rows });
        setPtyTerminals((current: PtyTerminalSession[]) =>
          current.map((entry: PtyTerminalSession) =>
            entry.terminalId === terminalId ? { ...entry, cols: size.cols, rows: size.rows } : entry
          )
        );
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client]
  );

  const loadPtyTail = useCallback(
    async (terminalId: string): Promise<string> => {
      const result = asRecord(await client.rpc("terminal/read", { terminalId, limitBytes: 65536 }));
      return typeof result.tail === "string" ? result.tail : "";
    },
    [client]
  );

  const openWorkspaceTerminal = useCallback(() => {
    void window.codexUltraDesktop?.openTerminal({ cwd: activeWorkspaceCwd, sshCommand: activeWorkspaceSshCommand, sshCwd: activeWorkspaceSshCwd });
  }, [activeWorkspaceCwd, activeWorkspaceSshCommand, activeWorkspaceSshCwd]);
  return {
    terminalSessions,
    setTerminalSessions,
    ptyTerminals,
    setPtyTerminals,
    ptyFocusTerminalId,
    setPtyFocusTerminalId,
    appendTerminalOutput,
    createPtyTerminal,
    runTerminalCommand,
    writeTerminalInput,
    terminateTerminal,
    resizeTerminal,
    writePtyTerminal,
    killPtyTerminal,
    forgetPtyTerminal,
    resizePtyTerminal,
    loadPtyTail,
    openWorkspaceTerminal,
  };
}
