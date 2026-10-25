#!/bin/sh
# Stand-in agent for offline bridge runs: answers every JSON-RPC line
# with a fixed result line (different bytes than the request, so the
# pump cannot pass on a pure echo unless the child is cat). Loops
# until stdin closes, like a real agent session process.
while IFS= read -r _line; do
  printf '{"jsonrpc":"2.0","id":1,"result":"pong"}\n'
done
