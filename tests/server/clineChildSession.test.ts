import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findClineChildFile,
  indexClineSpawnsFromTranscript,
  projectClineChildFile,
  recordClineSpawn,
} from "../../backends/cline/src/runtime/clineChildSession.js";

const REAL_SESSION = "C:/Users/zhan/.codex-ultra/cline/sessions/1792926333863_yetew";
const REAL_AGENT = "agent_787e4754-50f7-4ec5-87bf-b8726ba05a28.messages.json";

function stageSession(): { dataDir: string; cleanup: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), "cline-child-"));
  const dir = join(dataDir, "sessions", "sess-1");
  mkdirSync(dir, { recursive: true });
  cpSync(join(REAL_SESSION, REAL_AGENT), join(dir, REAL_AGENT));
  return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

describe("clineChildSession", () => {
  test("recordClineSpawn writes an index resolvable by task text", () => {
    const { dataDir, cleanup } = stageSession();
    try {
      const agentText = JSON.parse(readFileSync(join(dataDir, "sessions", "sess-1", REAL_AGENT), "utf8"))
        .messages[0].content[0].text as string;
      recordClineSpawn(dataDir, {
        toolCallId: "call-spawn-1",
        rootSessionId: "sess-1",
        task: agentText.slice(0, 160),
        systemPrompt: "你是 Codex Ultra 后端架构专家",
        startedAt: Date.now(),
      });
      const found = findClineChildFile(dataDir, "call-spawn-1");
      expect(found?.file).toBe(join(dataDir, "sessions", "sess-1", REAL_AGENT));
      expect(found?.rootSessionId).toBe("sess-1");
    } finally {
      cleanup();
    }
  });

  test("unknown card resolves nothing when ambiguous", () => {
    const { dataDir, cleanup } = stageSession();
    try {
      // Second candidate makes content matching impossible without an index.
      cpSync(
        join(dataDir, "sessions", "sess-1", REAL_AGENT),
        join(dataDir, "sessions", "sess-1", "agent_00000000-0000-0000-0000-000000000000.messages.json"),
      );
      expect(findClineChildFile(dataDir, "call-nope")).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("projectClineChildFile renders user/thinking/tools/report", () => {
    const { dataDir, cleanup } = stageSession();
    try {
      const file = join(dataDir, "sessions", "sess-1", REAL_AGENT);
      const proj = projectClineChildFile(file, "call-spawn-1", true);
      expect(proj).not.toBeNull();
      const types = (proj!.items.map((item) => String(item.type)));
      expect(types).toContain("userMessage");
      expect(types).toContain("reasoning");
      expect(types).toContain("toolCall");
      expect(types).toContain("agentMessage");
      const tool = proj!.items.find((item) => item.type === "toolCall")!;
      expect(String(tool.toolName)).toBe("read_files");
      expect(tool.status).toBe("completed");
      expect(String((tool.output as string) ?? "")).not.toBe("");
      expect(proj!.running).toBe(true);
      for (const item of proj!.items) {
        expect(String(item.threadId)).toBe("call-spawn-1");
      }
    } finally {
      cleanup();
    }
  });

  test("missing file projects nothing", () => {
    expect(projectClineChildFile(join(tmpdir(), "nope.json"), "x", false)).toBeNull();
  });

  test("team transcripts (agent-<agentId>__suffix) resolve by agentId, not prefix", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cline-child-team-"));
    const dir = join(dataDir, "sessions", "sess-team");
    mkdirSync(dir, { recursive: true });
    try {
      const base = JSON.parse(readFileSync(join(REAL_SESSION, REAL_AGENT), "utf8")) as Record<string, any>;
      const writeTeam = (file: string, agentId: string, firstUserText: string) => {
        const copy = JSON.parse(JSON.stringify(base)) as Record<string, any>;
        copy.origin = {
          source: "cli",
          mode: "team",
          sessionId: `sess-team__teamtask__${agentId}`,
          parentThreadId: "sess-team",
          subagent: agentId,
        };
        copy.messages = [{ role: "user", content: [{ type: "text", text: firstUserText }] }, ...base.messages];
        writeFileSync(join(dir, file), JSON.stringify(copy));
      };
      writeTeam("agent-testing__B2.messages.json", "agent-testing", "测试覆盖评估开始");
      // Written last so it is also the freshest file: only an agentId join
      // can pick the testing transcript for the run below.
      writeTeam("agent-arch__A1.messages.json", "agent-arch", "架构评估开始");
      // Index entry written before agentId capture: stale task text only.
      recordClineSpawn(dataDir, {
        toolCallId: "call-run-9",
        rootSessionId: "sess-team",
        task: "旧的任务提示，与任何子会话正文都不匹配",
        systemPrompt: "",
        startedAt: Date.now(),
      });
      writeFileSync(join(dir, "sess-team.messages.json"), JSON.stringify({
        version: 1,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "call-run-9",
            name: "team_run_task",
            input: { agentId: "agent-testing", task: "评估测试覆盖" },
          }],
        }],
      }));
      const found = findClineChildFile(dataDir, "call-run-9");
      expect(found?.file).toBe(join(dir, "agent-testing__B2.messages.json"));
      const proj = projectClineChildFile(found!.file, "call-run-9", true);
      expect(proj).not.toBeNull();
      expect(proj!.items.some((item) => item.type === "toolCall")).toBe(true);
      expect(String(proj!.items[0]?.threadId)).toBe("call-run-9");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("transcript backfill resolves pre-index cards by exact toolCallId", () => {
    const { dataDir, cleanup } = stageSession();
    try {
      const agentText = JSON.parse(readFileSync(join(dataDir, "sessions", "sess-1", REAL_AGENT), "utf8"))
        .messages[0].content[0].text as string;
      writeFileSync(join(dataDir, "sessions", "sess-1", "sess-1.messages.json"), JSON.stringify({
        version: 1,
        messages: [{
          role: "assistant",
          content: [{ type: "tool_use", id: "call-old-1", name: "spawn_agent", input: { systemPrompt: "sp", task: agentText.slice(0, 160) } }],
        }],
      }));
      expect(indexClineSpawnsFromTranscript(dataDir, "sess-1")).toBe(1);
      const found = findClineChildFile(dataDir, "call-old-1");
      expect(found?.file).toBe(join(dataDir, "sessions", "sess-1", REAL_AGENT));
    } finally {
      cleanup();
    }
  });
});
