#!/usr/bin/env node
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

// Emit system/init
process.stdout.write(JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "perm-session-" + process.pid,
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
      // Emit a permission request
      process.stdout.write(JSON.stringify({
        type: "control_request",
        request_id: "req-perm-" + Date.now(),
        session_id: "perm-session-" + process.pid,
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          tool_use_id: "tool-" + Date.now(),
          input: { command: "echo hello" },
          title: "Run bash command"
        }
      }) + "\n");

      // Wait for the control_response, then emit assistant + result
      // For this fake, we'll just emit after a short delay
      setTimeout(() => {
        process.stdout.write(JSON.stringify({
          type: "assistant",
          session_id: "perm-session-" + process.pid,
          uuid: "msg-perm-" + Date.now(),
          parent_tool_use_id: null,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Permission granted, proceeding!" }]
          }
        }) + "\n");
        process.stdout.write(JSON.stringify({
          type: "result",
          subtype: "success",
          session_id: "perm-session-" + process.pid,
          uuid: "result-perm-" + Date.now(),
          is_error: false,
          result: "Permission granted, proceeding!",
          duration_ms: 100,
          total_cost_usd: 0.001,
          num_turns: 1
        }) + "\n");
      }, 500);
    }
  } catch (e) {
    // Ignore
  }
});

rl.on("close", () => {
  process.exit(0);
});
