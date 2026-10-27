#!/usr/bin/env node
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

// Emit system/init
process.stdout.write(JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "fake-session-" + process.pid,
  claude_code_version: "2.1.222",
  cwd: process.cwd(),
  model: "claude-sonnet-4-20250514",
  permissionMode: "default",
  tools: ["Read", "Write", "Bash"]
}) + "\n");

rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.type === "user" && msg.message && msg.message.content) {
      // Emit assistant text
      process.stdout.write(JSON.stringify({
        type: "assistant",
        session_id: "fake-session-" + process.pid,
        uuid: "msg-" + Date.now(),
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello from fake Claude CLI!" }]
        }
      }) + "\n");
      // Emit result
      process.stdout.write(JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "fake-session-" + process.pid,
        uuid: "result-" + Date.now(),
        is_error: false,
        result: "Hello from fake Claude CLI!",
        duration_ms: 100,
        total_cost_usd: 0.001,
        num_turns: 1
      }) + "\n");
    }
  } catch (e) {
    // Ignore unparseable lines
  }
});

rl.on("close", () => {
  process.exit(0);
});
