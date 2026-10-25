import { execFile } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { spawnRuntimeProcess } from "./runtime/process.js";
import type { SshWorkspaceProfile } from "../../../backends/codex/src/runtime/sshCodexBridge.js";
import type { NormalizedSaVmPolicy } from "../../../backends/vmtool-security/src/security/saVmPolicy.js";
import { checkSaVmDelete, pathWithin } from "../../../backends/vmtool-security/src/security/saVmPolicy.js";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type GitRunner = (cwd: string, args: string[], allowedExitCodes?: number[]) => Promise<GitCommandResult>;
type PathRemover = (repoRoot: string, path: string) => Promise<void>;
const execFileAsync = promisify(execFile);

type GitStatusEntry = {
  path: string;
  oldPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

export async function handleWorkspaceGitRpc(
  method: string,
  params: Record<string, unknown>,
  sshProfile?: SshWorkspaceProfile | null,
  vmPolicy?: NormalizedSaVmPolicy,
): Promise<unknown> {
  const cwd = requiredString(params.cwd, "cwd");
  const run = sshProfile ? createSshGitRunner(sshProfile) : runGit;
  const removePath = sshProfile ? createSshPathRemover(sshProfile) : (repoRoot: string, path: string) => removeLocalPath(repoRoot, path, vmPolicy);

  if (method === "ui/git/status") {
    return readStatus(cwd, run);
  }
  if (method === "ui/git/diff") {
    return readDiff(cwd, optionalString(params.path), params.staged === true, run);
  }
  if (method === "gitDiffToRemote") {
    const repoRoot = await requireRepoRoot(cwd, run);
    const headResult = await run(repoRoot, ["rev-parse", "HEAD"], [0, 128]);
    const sha = headResult.exitCode === 0 ? headResult.stdout.trim() : "";
    const upstreamResult = await run(repoRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"], [0, 128]);
    const upstream = upstreamResult.exitCode === 0 && upstreamResult.stdout.trim() ? upstreamResult.stdout.trim() : "origin/HEAD";
    const diffResult = await run(repoRoot, ["diff", `${upstream}...HEAD`], [0, 128]);
    const diff = diffResult.exitCode === 0 ? diffResult.stdout : (await run(repoRoot, ["diff", "HEAD"], [0, 128])).stdout;
    return { sha, diff };
  }
  if (method === "ui/git/history") {
    return readHistory(cwd, clampInteger(params.limit, 1, 200, 50), run);
  }
  if (method === "ui/git/show") {
    return readCommit(cwd, requiredString(params.sha, "sha"), run);
  }
  if (method === "ui/git/stage") {
    await mutatePaths(cwd, ["add", "--"], stringArray(params.paths), run);
    return readStatus(cwd, run);
  }
  if (method === "ui/git/unstage") {
    await mutatePaths(cwd, ["restore", "--staged", "--"], stringArray(params.paths), run);
    return readStatus(cwd, run);
  }
  if (method === "ui/git/discard") {
    await discardPaths(cwd, stringArray(params.paths), params.untracked === true, run, removePath);
    return readStatus(cwd, run);
  }
  if (method === "ui/git/commit") {
    const message = requiredString(params.message, "message");
    const amend = params.amend === true;
    const result = await run(cwd, amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message]);
    return { message: result.stdout.trim() || result.stderr.trim(), status: await readStatus(cwd, run) };
  }
  if (method === "ui/git/stage-all") {
    await mutatePaths(cwd, ["add", "-A"], [], run);
    return readStatus(cwd, run);
  }
  if (method === "ui/git/unstage-all") {
    await mutatePaths(cwd, ["restore", "--staged", "."], [], run);
    return readStatus(cwd, run);
  }
  if (method === "ui/git/branches") {
    return readBranches(cwd, run);
  }
  if (method === "ui/git/checkout") {
    const branch = requiredString(params.branch, "branch");
    const create = params.create === true;
    const repoRoot = await requireRepoRoot(cwd, run);
    resolveRepoPath(repoRoot, branch);
    await run(repoRoot, create ? ["checkout", "-b", branch] : ["checkout", branch]);
    return readStatus(cwd, run);
  }
  if (method === "ui/git/branch-delete") {
    const branch = requiredString(params.branch, "branch");
    const force = params.force === true;
    const repoRoot = await requireRepoRoot(cwd, run);
    resolveRepoPath(repoRoot, branch);
    await run(repoRoot, ["branch", force ? "-D" : "-d", branch]);
    return { branches: await readBranches(cwd, run), status: await readStatus(cwd, run) };
  }
  if (method === "ui/git/stash-list") {
    return readStashList(cwd, run);
  }
  if (method === "ui/git/stash-push") {
    const message = optionalString(params.message);
    const includeUntracked = params.includeUntracked === true;
    const repoRoot = await requireRepoRoot(cwd, run);
    const args = ["stash", "push"];
    if (includeUntracked) args.push("-u");
    if (message) args.push("-m", message);
    await run(repoRoot, args);
    return { stash: await readStashList(cwd, run), status: await readStatus(cwd, run) };
  }
  if (method === "ui/git/stash-apply") {
    const index = clampInteger(params.index, 0, 1024, 0);
    const pop = params.pop === true;
    const repoRoot = await requireRepoRoot(cwd, run);
    await run(repoRoot, ["stash", pop ? "pop" : "apply", `stash@{${index}}`]);
    return { stash: await readStashList(cwd, run), status: await readStatus(cwd, run) };
  }
  if (method === "ui/git/stash-drop") {
    const index = clampInteger(params.index, 0, 1024, 0);
    const repoRoot = await requireRepoRoot(cwd, run);
    await run(repoRoot, ["stash", "drop", `stash@{${index}}`]);
    return { stash: await readStashList(cwd, run), status: await readStatus(cwd, run) };
  }
  if (method === "ui/git/fetch") {
    const repoRoot = await requireRepoRoot(cwd, run);
    await run(repoRoot, ["fetch", "--prune"]);
    return readStatus(cwd, run);
  }
  if (method === "ui/git/pull") {
    const repoRoot = await requireRepoRoot(cwd, run);
    const result = await run(repoRoot, ["pull", "--ff-only"]);
    return { message: result.stdout.trim() || result.stderr.trim(), status: await readStatus(cwd, run) };
  }
  if (method === "ui/git/push") {
    const repoRoot = await requireRepoRoot(cwd, run);
    const setUpstream = params.setUpstream === true;
    const args = setUpstream ? ["push", "-u", "origin", "HEAD"] : ["push"];
    const result = await run(repoRoot, args);
    return { message: result.stdout.trim() || result.stderr.trim(), status: await readStatus(cwd, run) };
  }

  throw new Error(`Unsupported workspace Git method: ${method}`);
}

export function isWorkspaceGitMethod(method: string): boolean {
  return method.startsWith("ui/git/") || method === "gitDiffToRemote";
}

export function isWorkspaceGitMutation(method: string): boolean {
  return (
    method === "ui/git/stage" ||
    method === "ui/git/unstage" ||
    method === "ui/git/stage-all" ||
    method === "ui/git/unstage-all" ||
    method === "ui/git/discard" ||
    method === "ui/git/commit" ||
    method === "ui/git/checkout" ||
    method === "ui/git/branch-delete" ||
    method === "ui/git/stash-push" ||
    method === "ui/git/stash-apply" ||
    method === "ui/git/stash-drop" ||
    method === "ui/git/fetch" ||
    method === "ui/git/pull" ||
    method === "ui/git/push"
  );
}

async function readStatus(cwd: string, run: GitRunner) {
  const repoRootResult = await run(cwd, ["rev-parse", "--show-toplevel"], [0, 128]);
  if (repoRootResult.exitCode !== 0) {
    return {
      isRepository: false,
      repoRoot: cwd,
      branch: "",
      upstream: "",
      ahead: 0,
      behind: 0,
      entries: [],
    };
  }

  const repoRoot = repoRootResult.stdout.trim();
  const [branchResult, upstreamResult, statusResult] = await Promise.all([
    run(repoRoot, ["branch", "--show-current"]),
    run(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], [0, 128]),
    run(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  const upstream = upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() : "";
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = await run(repoRoot, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
    const [aheadText, behindText] = counts.stdout.trim().split(/\s+/);
    ahead = Number(aheadText) || 0;
    behind = Number(behindText) || 0;
  }

  return {
    isRepository: true,
    repoRoot,
    branch: branchResult.stdout.trim() || "HEAD",
    upstream,
    ahead,
    behind,
    entries: parseStatusEntries(statusResult.stdout),
  };
}

async function readDiff(cwd: string, path: string | undefined, staged: boolean, run: GitRunner) {
  const repoRoot = await requireRepoRoot(cwd, run);
  const args = ["diff"];
  if (staged) args.push("--cached");
  args.push("--no-ext-diff", "--binary");
  if (path) args.push("--", path);
  let result = await run(repoRoot, args);

  if (!staged && path && !result.stdout.trim()) {
    // Untracked file: diff against the null device. Validate containment, then
    // pass the repo-relative path (forward slashes) so the patch header reads
    // `b/<path>` on every platform instead of leaking `D:\...` absolutes.
    // Git special-cases the literal "/dev/null" on Windows too.
    resolveRepoPath(repoRoot, path);
    result = await run(repoRoot, ["diff", "--no-index", "--binary", "--", "/dev/null", normalizeGitRelativePath(path)], [0, 1]);
  }

  return { patch: result.stdout, path: path ?? "", staged };
}

async function readHistory(cwd: string, limit: number, run: GitRunner) {
  const repoRoot = await requireRepoRoot(cwd, run);
  const format = "%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1e";
  const result = await run(repoRoot, [
    "log",
    `--max-count=${limit}`,
    "--date-order",
    `--format=${format}`,
  ]);
  const commits = result.stdout
    .split("\x1e")
    .map((record) => record.replace(/^\s+|\s+$/g, ""))
    .filter(Boolean)
    .map((record) => {
      const [sha, shortSha, author, email, timestamp, subject, refs] = record.split("\x1f");
      return {
        sha,
        shortSha,
        author,
        email,
        timestamp: Number(timestamp) || 0,
        subject,
        refs: refs ? refs.split(",").map((item) => item.trim()).filter(Boolean) : [],
      };
    });
  return { repoRoot, commits };
}

async function readCommit(cwd: string, sha: string, run: GitRunner) {
  const repoRoot = await requireRepoRoot(cwd, run);
  const result = await run(repoRoot, [
    "show",
    "--no-ext-diff",
    "--binary",
    "--format=fuller",
    "--stat",
    "--patch",
    sha,
  ]);
  return { repoRoot, sha, patch: result.stdout };
}

async function readBranches(cwd: string, run: GitRunner) {
  const repoRoot = await requireRepoRoot(cwd, run);
  const currentResult = await run(repoRoot, ["branch", "--show-current"]);
  const current = currentResult.stdout.trim();
  const result = await run(repoRoot, ["branch", "--all", "--format=%(refname:short)%00%(upstream:short)%00%(objectname:short)"]);
  const branches = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", upstream = "", shortSha = ""] = line.split("\0");
      const remote = name.includes("/") && !name.startsWith("HEAD");
      return { name, current: name === current, remote, upstream, shortSha };
    })
    .filter((branch) => branch.name && !branch.name.startsWith("HEAD "));
  return { repoRoot, current, branches };
}

async function readStashList(cwd: string, run: GitRunner) {
  const repoRoot = await requireRepoRoot(cwd, run);
  const result = await run(repoRoot, ["stash", "list", "--format=%gd%x1f%gs%x1f%at"]);
  const entries = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, listIndex) => {
      const [ref = "", subject = "", timestamp = ""] = line.split("\x1f");
      const match = ref.match(/stash@\{(\d+)\}/);
      return {
        index: match ? Number(match[1]) : listIndex,
        ref,
        subject,
        timestamp: Number(timestamp) || 0
      };
    });
  return { repoRoot, entries };
}

async function mutatePaths(cwd: string, args: string[], paths: string[], run: GitRunner) {
  const repoRoot = await requireRepoRoot(cwd, run);
  const safePaths = paths.length > 0 ? paths : ["."];
  for (const path of safePaths) resolveRepoPath(repoRoot, path);
  await run(repoRoot, [...args, ...safePaths]);
}

async function discardPaths(cwd: string, paths: string[], untracked: boolean, run: GitRunner, removePath: PathRemover) {
  if (paths.length === 0) throw new Error("At least one path is required");
  const repoRoot = await requireRepoRoot(cwd, run);
  if (untracked) {
    for (const path of paths) {
      await removePath(repoRoot, path);
    }
    return;
  }
  for (const path of paths) resolveRepoPath(repoRoot, path);
  await run(repoRoot, ["restore", "--worktree", "--", ...paths]);
}

async function requireRepoRoot(cwd: string, run: GitRunner): Promise<string> {
  const result = await run(cwd, ["rev-parse", "--show-toplevel"], [0, 128]);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error("The selected workspace is not a Git repository");
  }
  return result.stdout.trim();
}

async function removeLocalPath(repoRoot: string, path: string, vmPolicy?: NormalizedSaVmPolicy): Promise<void> {
  const target = resolveRepoPath(repoRoot, path);
  if (!vmPolicy) {
    await rm(target, { recursive: true, force: true });
    return;
  }
  const decision = checkSaVmDelete(vmPolicy, target, repoRoot);
  if (!decision.allowed) throw new Error(`SA-VM policy denied Git discard: ${decision.reason}`);
  if (vmPolicy.fs.delete === "deny") throw new Error("SA-VM delete policy is deny");
  const backupPattern = vmPolicy.fs.backupDir;
  if (!backupPattern) throw new Error("SA-VM delete policy requires backupDir");
  const backupRoot = backupPattern.replace(/\/\*\*$/, "");
  const backupPath = resolve(backupRoot, `${relative(resolve(repoRoot), target)}.${Date.now()}.bak`);
  if (!pathWithin(backupRoot, backupPath)) throw new Error("SA-VM backup path is outside backupDir");
  await mkdir(dirname(backupPath), { recursive: true });
  await rename(target, backupPath);
}

function createSshGitRunner(profile: SshWorkspaceProfile): GitRunner {
  const sshArgs = splitCommand(profile.command);
  assertSshCommand(sshArgs);
  return async (cwd, args, allowedExitCodes = [0]) => {
    try {
      const remoteCommand = `cd -- ${shellQuote(cwd)} && LC_ALL=C GIT_OPTIONAL_LOCKS=0 git ${[...GIT_BASE_FLAGS, ...args].map(shellQuote).join(" ")}`;
      const result = await execFileAsync("ssh", [...sshArgs.slice(1), remoteCommand], { maxBuffer: 32 * 1024 * 1024 });
      return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), exitCode: 0 };
    } catch (error) {
      const details = error as { code?: number; stdout?: string; stderr?: string; message?: string };
      const exitCode = typeof details.code === "number" ? details.code : 1;
      const stdout = String(details.stdout ?? "");
      const stderr = String(details.stderr ?? "");
      if (allowedExitCodes.includes(exitCode)) return { stdout, stderr, exitCode };
      throw new Error(stderr.trim() || stdout.trim() || details.message || `Remote git ${args[0] ?? ""} failed (${exitCode})`);
    }
  };
}

function createSshPathRemover(profile: SshWorkspaceProfile): PathRemover {
  const sshArgs = splitCommand(profile.command);
  assertSshCommand(sshArgs);
  return async (repoRoot, path) => {
    const relativePath = normalizeGitRelativePath(path);
    await execFileAsync("ssh", [...sshArgs.slice(1), `cd -- ${shellQuote(repoRoot)} && rm -rf -- ${shellQuote(relativePath)}`], { maxBuffer: 1024 * 1024 });
  };
}

function normalizeGitRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized === ".") return ".";
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Git path is outside the repository: ${path}`);
  }
  return normalized;
}

function splitCommand(value: string): string[] {
  const matches = value.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => {
    const quoted = (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"));
    return quoted ? part.slice(1, -1) : part;
  });
}

function assertSshCommand(parts: string[]): void {
  if (parts[0] !== "ssh" || parts.length < 2) throw new Error("SSH command must look like: ssh user@host");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function resolveRepoPath(repoRoot: string, path: string, platform: NodeJS.Platform = process.platform): string {
  if (!path || path === ".") return repoRoot;
  const root = resolve(repoRoot);
  const target = resolve(root, path);
  // `git rev-parse --show-toplevel` returns `D:/x` on Windows while resolve()
  // yields `D:\x`, and NTFS is case-insensitive (`d:` vs `D:`). Compare via
  // relative() so drive-root repos (`C:\`) and casing differences both work.
  const rel = platform === "win32"
    ? relative(root.toLowerCase(), target.toLowerCase())
    : relative(root, target);
  if (rel === "") return target;
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(`Git path is outside the repository: ${path}`);
  }
  return target;
}

/** Git flags applied to every invocation: never octal-escape non-ASCII paths (中文文件名). */
export const GIT_BASE_FLAGS = ["-c", "core.quotepath=false"];

async function runGit(
  cwd: string,
  args: string[],
  allowedExitCodes: number[] = [0],
): Promise<GitCommandResult> {
  const child = spawnRuntimeProcess(["git", ...GIT_BASE_FLAGS, ...args], {
    cwd,
    env: { ...processEnv(), LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (!allowedExitCodes.includes(exitCode)) {
    throw new Error(stderr.trim() || stdout.trim() || `git ${args[0] ?? ""} failed (${exitCode})`);
  }
  return { stdout, stderr, exitCode };
}

function parseStatusEntries(value: string): GitStatusEntry[] {
  const records = value.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    const renamed = indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C";
    const oldPath = renamed ? records[++index] || undefined : undefined;
    const untracked = indexStatus === "?" && worktreeStatus === "?";
    entries.push({
      path,
      ...(oldPath ? { oldPath } : {}),
      indexStatus,
      worktreeStatus,
      staged: !untracked && indexStatus !== " " && indexStatus !== "?",
      unstaged: untracked || (worktreeStatus !== " " && worktreeStatus !== "?"),
      untracked,
    });
  }
  return entries;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? Math.trunc(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
  );
}
