# VS Code MCP Extension

This extension works alongside the Code MCP Server to provide native VS Code integration features like:

- File diffing with Accept/Reject
- Opening files

## Usage

The extension runs in the background and responds to requests from the Code MCP Server. No direct user interaction is required.

## Requirements

- VS Code 1.85.0 or higher
- Code MCP Server

Extension URL: https://marketplace.visualstudio.com/items?itemName=gertig.mcp-extension
Hub URL: https://marketplace.visualstudio.com/manage/publishers/gertig/extensions/mcp-extension/hub

## Publishing to the VS Code Marketplace

```bash
npx vsce login <publisher_id>
# (e.g. gertig)

npx vsce publish
```
