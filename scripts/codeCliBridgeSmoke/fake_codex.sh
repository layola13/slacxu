#!/bin/bash
# Protocol double for the slice-5 session phase: answers the codex
# handshake shapes measured live, and completes the turn ONLY when
# turn/start carries the thread id issued by thread/start.
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*)
      printf '{"id":1,"result":{"userAgent":"fake-codex/0.1"}}\n' ;;
    *'"method":"initialized"'*)
      : ;;
    *'"id":2'*)
      printf '{"id":2,"result":{"data":[]}}\n' ;;
    *'"id":3'*)
      printf '{"id":3,"result":{"thread":{"id":"tid-123-abc","sessionId":"tid-123-abc","modelProvider":"zen","model":"big-pickle"}}}\n' ;;
    *'"id":4'*)
      case "$line" in
        *'"threadId":"tid-123-abc"'*)
          printf '{"id":4,"result":{"turn":{"id":"turn-1","status":"inProgress"}}}\n'
          printf '{"method":"turn/started","params":{"threadId":"tid-123-abc"}}\n'
          printf '{"method":"item/agentMessage/delta","params":{"delta":"ok"}}\n'
          printf '{"method":"turn/completed","params":{"turn":{"status":"completed"}}}\n' ;;
        *)
          printf '{"id":4,"error":{"message":"missing or wrong threadId"}}\n' ;;
      esac ;;
  esac
done
