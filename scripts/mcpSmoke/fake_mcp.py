#!/usr/bin/env python3
"""Fake MCP server (stdio JSON-RPC) for the slacxu MCP smokes.

Tools:
  echo_text       {text}  -> "echo:<text>"
  workspace_fact  {}      -> "MCPWORD42"
Unknown tools get a JSON-RPC error. Every request method is
appended to $FAKE_MCP_LOG when that env var is set.
"""
import json
import os
import sys

TOOLS = [
    {
        "name": "echo_text",
        "description": "Echoes the text argument back with an echo: prefix",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {
        "name": "workspace_fact",
        "description": "Returns the workspace fact word",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def log(method):
    path = os.environ.get("FAKE_MCP_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(method + "\n")


def reply(mid, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": mid}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        method = req.get("method", "")
        log(method)
        mid = req.get("id")
        if mid is None:
            continue  # notification: no reply
        if method == "initialize":
            reply(mid, {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fake-mcp", "version": "1.0.0"},
            })
        elif method == "tools/list":
            reply(mid, {"tools": TOOLS})
        elif method == "tools/call":
            params = req.get("params") or {}
            name = params.get("name", "")
            args = params.get("arguments") or {}
            if name == "echo_text":
                reply(mid, {"content": [{"type": "text",
                                          "text": "echo:" + str(args.get("text", ""))}]})
            elif name == "workspace_fact":
                reply(mid, {"content": [{"type": "text", "text": "MCPWORD42"}]})
            else:
                reply(mid, error={"code": -32602, "message": "unknown tool: " + name})
        else:
            reply(mid, error={"code": -32601, "message": "method not found: " + method})


if __name__ == "__main__":
    main()
