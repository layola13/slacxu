#!/bin/sh
# Stand-in agent for offline bridge runs: reads one JSON-RPC line and
# answers with a fixed result line (different bytes than the request,
# so the pump cannot pass on a pure echo unless the child is cat).
read -r _line
printf '{"jsonrpc":"2.0","id":1,"result":"pong"}\n'
