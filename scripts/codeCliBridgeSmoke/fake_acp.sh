#!/bin/bash
# Protocol double for the ACP session shape (opencode): completes
# the prompt only when it carries the session id issued by
# session/new.
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*)
      printf '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"FakeACP","version":"0.1"}}}\n' ;;
    *'"id":2'*)
      printf '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"sess-42","models":{"currentModelId":"opencode/big-pickle"}}}\n' ;;
    *'"id":3'*)
      case "$line" in
        *'"sessionId":"sess-42"'*)
          printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess-42","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"ok"}}}}\n'
          printf '{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}\n' ;;
        *)
          printf '{"jsonrpc":"2.0","id":3,"error":{"message":"missing or wrong sessionId"}}\n' ;;
      esac ;;
  esac
done
