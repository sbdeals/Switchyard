#!/bin/bash
export DOKPLOY_URL=http://127.0.0.1:3000 DOKPLOY_EMAIL=admin@switchyard.local DOKPLOY_PASSWORD="$(cat /etc/dokploy-bridge-secrets/admin)"
cd "$(dirname "$0")"
echo "########## BEFORE: origin/main (1fc46d5) mcp/dist ##########"; node demo.mjs /tmp/mcp-main/mcp/dist
sleep 20; echo; echo "########## AFTER: codex/mcp-unambiguous-targets mcp/dist ##########"; node demo.mjs /workspace/wt-mcp-unambiguous-targets/mcp/dist
