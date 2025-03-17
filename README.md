# VSCode MCP

This monorepo contains the VSCode MCP Server and its companion VSCode Extension, which together enable AI agents and assistants, like Goose or Claude, to interact with VSCode through the Model Context Protocol.

## Project Structure

```
vscode-mcp/
├── server/    # MCP server implementation
└── extension/ # VS Code extension
```

## Quick Start

1. Install the MCP Server

```bash
npx vscode-mcp-server install
```

2. Install the MCP Extension

> [MCP Extension](https://marketplace.visualstudio.com/items?itemName=gertig.mcp-extension)

## Configuration

### Goose Desktop Setup

![Goose Settings](assets/GooseSettings.png)

- ID: `code-mcp`
- Name: `VS Code`
- Description: `Allows interaction with VS Code through the Model Context Protocol`
- Command: `npx vscode-mcp-server`

### Claude Desktop Setup

Add this to your Claude Desktop config file (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vscode-mcp-server": {
      "command": "npx",
      "args": ["vscode-mcp-server"],
      "env": {}
    }
  }
}
```

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Copyright 2025 Block, Inc.

This product includes software developed at [Block, Inc.](https://block.xyz/)
