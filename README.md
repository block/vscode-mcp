# Code MCP

This monorepo contains the Code MCP Server and its companion VS Code extension, which together enable AI agents and assistants, like Goose or Claude, to interact with VS Code through the Model Context Protocol.

## Project Structure

```
code-mcp/
├── server/    # MCP server implementation
└── extension/ # VS Code extension
```

## Quick Start

1. Install the MCP Server

```bash
npx code-mcp-server install
```

2. Install the MCP Extension

> [MCP Extension](https://marketplace.visualstudio.com/items?itemName=gertig.mcp-extension)

## Configuration

### Goose Desktop Setup

![Goose Settings](assets/GooseSettings.png)

- ID: `code-mcp`
- Name: `VS Code`
- Description: `Allows interaction with VS Code through the Model Context Protocol`
- Command: `npx code-mcp-server`

### Claude Desktop Setup

Add this to your Claude Desktop config file (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "code-mcp-server": {
      "command": "npx",
      "args": ["code-mcp-server"],
      "env": {}
    }
  }
}
```

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Copyright 2025 Block, Inc.

This product includes software developed at [Block, Inc.](https://block.xyz/)
