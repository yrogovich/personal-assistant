#!/bin/sh
# Starts the dashboard's MCP server for Claude Desktop (stdio). See SETUP.md → Claude Desktop.
cd "$(dirname "$0")/.." || exit 1
exec "${NODE_BIN:-node}" --conditions=react-server --import tsx src/mcp/server.mts
