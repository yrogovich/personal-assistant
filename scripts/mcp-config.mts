// Prints the Claude Desktop config entry for the dashboard's MCP server.
// Paste it into ~/Library/Application Support/Claude/claude_desktop_config.json under "mcpServers".
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
console.log(
  JSON.stringify(
    {
      mcpServers: {
        "personal-dashboard": {
          command: path.join(root, "scripts/mcp-server.sh"),
          env: { NODE_BIN: process.execPath },
        },
      },
    },
    null,
    2,
  ),
);
