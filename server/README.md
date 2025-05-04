# Code MCP Server

A Model Context Protocol (MCP) server for VS Code integration, enabling AI agents like Goose or Claude to interact with VS Code.

## Features

- File diffing
- Opening files
- more to come

## Installation

You can install the Code MCP Server using npx:

```bash
npx vscode-mcp-server install
```

This command will:

1. Check your operating system compatibility (Windows/macOS)
2. Install the server
3. Generate a Goose install URL that you can copy and paste it into a browser to easily istall the Goose Extension.

### Local Installation Using npm pack

If you want to test the package locally before publishing to npm, you can use `npm pack`:

1. Clone the repository and navigate to the server directory:

   ```bash
   git clone https://github.com/block/code-mcp.git
   cd code-mcp/server
   ```

2. Create a tarball of the package:

   ```bash
   npm pack
   ```

   This will create a file like `vscode-mcp-server-X.X.X.tgz` in the current directory.

3. Install the package globally from the local tarball:

   ```bash
   npm install -g ./vscode-mcp-server-X.X.X.tgz
   ```

## Usage

Once installed, you can configure your AI assistant to use this server. The server provides various tools for interacting with VS Code, including:

- Opening files
- Creating Diffs of file changes that require Accept/Reject

## Configuration
y
After installation, you'll need to configure your AI assistant to use this server.

### Goose Desktop Configuration

![Goose Settings](../assets/GooseSettings.png)

- ID: `vscode-mcp-server`
- Name: `VSCode MCP Server`
- Description: `Allows interaction with VSCode through the Model Context Protocol`
- Command: `npx vscode-mcp-server`

### Claude Desktop Configuration

Add the following to your Claude Desktop configuration file:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

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

### Other AI Assistants

For other AI assistants that support the Model Context Protocol, refer to their documentation for how to configure external MCP servers. You'll typically need to provide:

1. The command `npx vscode-mcp-server`
2. Any required environment variables

## Development

### Automated Publishing with GitHub Actions (WIP)

1. release.yml: Automatically creates a new release when you push to the main branch with conventional commit messages
2. npm-publish.yml: Automatically publishes to npm when a new release is created

To use these workflows:

1. Push your changes to GitHub with conventional commit messages (e.g., "feat: add install command")
2. The release workflow will create a new release with an incremented version
3. The npm-publish workflow will then publish the new version to npm

You'll need to add an npm token to your GitHub repository secrets:

1. Generate an npm token: npm token create
2. Add the token to your GitHub repository secrets as npm_token

### Updating the Package

Update the version

`npm version patch/minor/major`

Publish

`npm publish`
