import * as vscode from "vscode";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

export function activate(context: vscode.ExtensionContext) {
  console.log("MCP Companion extension activating...");

  // Register commands once at activation time
  const acceptDisposable = vscode.commands.registerCommand(
    "mcp.acceptChanges",
    async () => {
      if (currentResolveChoice) {
        currentResolveChoice(true);
        currentAcceptButton?.dispose();
        currentRejectButton?.dispose();

        // Close the active diff editor
        await vscode.commands.executeCommand(
          "workbench.action.closeActiveEditor"
        );

        // Open the original file if we have its path
        if (currentOriginalFilePath) {
          const document = await vscode.workspace.openTextDocument(
            vscode.Uri.file(currentOriginalFilePath)
          );
          await vscode.window.showTextDocument(document);
          currentOriginalFilePath = undefined;
        }

        currentResolveChoice = undefined;
      }
    }
  );

  const rejectDisposable = vscode.commands.registerCommand(
    "mcp.rejectChanges",
    async () => {
      if (currentResolveChoice) {
        currentResolveChoice(false);
        currentAcceptButton?.dispose();
        currentRejectButton?.dispose();

        // Close the active diff editor
        await vscode.commands.executeCommand(
          "workbench.action.closeActiveEditor"
        );

        // Open the original file if we have its path
        if (currentOriginalFilePath) {
          const document = await vscode.workspace.openTextDocument(
            vscode.Uri.file(currentOriginalFilePath)
          );
          await vscode.window.showTextDocument(document);
          currentOriginalFilePath = undefined;
        }

        currentResolveChoice = undefined;
      }
    }
  );

  // Add these to context.subscriptions
  context.subscriptions.push(acceptDisposable, rejectDisposable);

  // Track current state
  let currentResolveChoice: ((accepted: boolean) => void) | undefined;
  let currentAcceptButton: vscode.StatusBarItem | undefined;
  let currentRejectButton: vscode.StatusBarItem | undefined;
  let currentOriginalFilePath: string | undefined;

  // Create a local socket server to receive commands from the MCP server
  const server = net.createServer((socket) => {
    console.log("MCP Companion: New connection received");

    socket.on("data", async (data) => {
      try {
        const command = JSON.parse(data.toString());
        console.log("MCP Companion: Received command:", command);

        if (command.type === "showDiff") {
          const { originalPath, modifiedPath, title } = command;
          console.log("MCP Companion: Showing diff:", {
            originalPath,
            modifiedPath,
            title,
          });

          // Store the original file path for later use
          currentOriginalFilePath = originalPath;

          // Create accept/reject buttons
          currentAcceptButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
          );
          currentAcceptButton.text = "$(check) Accept Changes";
          currentAcceptButton.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.warningBackground"
          );
          currentAcceptButton.command = "mcp.acceptChanges";

          currentRejectButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
          );
          currentRejectButton.text = "$(x) Reject Changes";
          currentRejectButton.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.errorBackground"
          );
          currentRejectButton.command = "mcp.rejectChanges";

          let resolveChoice: (accepted: boolean) => void;
          const choice = new Promise<boolean>((resolve) => {
            resolveChoice = resolve;
            currentResolveChoice = resolve;
          });

          // Show buttons
          currentAcceptButton.show();
          currentRejectButton.show();

          // Show diff
          await vscode.commands.executeCommand(
            "vscode.diff",
            vscode.Uri.file(originalPath),
            vscode.Uri.file(modifiedPath),
            `${title} (Review Changes)`
          );

          // Wait for user choice
          const accepted = await choice;

          if (accepted) {
            socket.write(JSON.stringify({ success: true, accepted: true }));
            console.log("MCP Companion: Changes accepted");
          } else {
            socket.write(JSON.stringify({ success: true, accepted: false }));
            console.log("MCP Companion: Changes rejected");
          }
        } else if (command.type === "open") {
          // Handle the open command
          const { filePath, options } = command;
          console.log("MCP Companion: Opening file:", filePath, options);

          try {
            // Convert file path to URI
            const uri = vscode.Uri.file(filePath);

            // Open the document
            const document = await vscode.workspace.openTextDocument(uri);

            // Show the document in the editor
            await vscode.window.showTextDocument(document, options);

            // Send success response
            socket.write(JSON.stringify({ success: true }));
            console.log("MCP Companion: File opened successfully");
          } catch (error) {
            console.error("MCP Companion: Error opening file:", error);
            socket.write(
              JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              })
            );
          }
        } else if (command.type === "openFolder") {
          // Handle the openFolder command
          const { folderPath, newWindow } = command;
          console.log("MCP Companion: Opening folder:", folderPath, {
            newWindow,
          });

          try {
            // Convert folder path to URI
            const uri = vscode.Uri.file(folderPath);

            // Use the VS Code API to open the folder
            await vscode.commands.executeCommand("vscode.openFolder", uri, {
              forceNewWindow: newWindow,
            });

            // Send success response
            socket.write(JSON.stringify({ success: true }));
            console.log("MCP Companion: Folder opened successfully");
          } catch (error) {
            console.error("MCP Companion: Error opening folder:", error);
            socket.write(
              JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              })
            );
          }
        } else if (command.type === "getCurrentWorkspace") {
          console.log("MCP Companion: Getting current workspace");

          try {
            // Get all open workspaces
            const workspaces =
              vscode.workspace.workspaceFolders?.map(
                (folder) => folder.uri.fsPath
              ) || [];

            socket.write(
              JSON.stringify({
                success: true,
                workspaces,
              })
            );
            console.log("MCP Companion: Sent workspace info");
          } catch (error) {
            console.error(
              "MCP Companion: Error getting workspace info:",
              error
            );
            socket.write(
              JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              })
            );
          }
        } else if (command.type === "ping") {
          console.log("MCP Companion: Received ping");
          socket.write(JSON.stringify({ success: true }));
          console.log("MCP Companion: Responded to ping");
        } else if (command.type === "focusWindow") {
          console.log("MCP Companion: Focusing window");

          try {
            // Focus the VS Code window
            await vscode.commands.executeCommand(
              "workbench.action.focusActiveEditorGroup"
            );

            // Send success response
            socket.write(JSON.stringify({ success: true }));
            console.log("MCP Companion: Window focused successfully");
          } catch (error) {
            console.error("MCP Companion: Error focusing window:", error);
            socket.write(
              JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              })
            );
          }
        }
      } catch (error: unknown) {
        console.error("MCP Companion: Error handling command:", error);
        socket.write(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });

    socket.on("error", (error) => {
      console.error("MCP Companion: Socket error:", error);
    });
  });

  // Helper function to update the port registry
  async function updatePortRegistry(
    registryPath: string,
    workspaceKeys: string[],
    port: number
  ): Promise<void> {
    let registry: Record<string, number> = {};

    // Try to read existing registry
    try {
      const content = await fs.readFile(registryPath, "utf-8");
      registry = JSON.parse(content);
    } catch (error) {
      // If file doesn't exist or is invalid, start with empty registry
      console.log(`MCP Companion: Creating new registry at ${registryPath}`);
    }

    // Add or update entries for this instance's workspaces
    for (const workspace of workspaceKeys) {
      registry[workspace] = port;
    }

    // Write updated registry back to file
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
  }

  // Helper function to remove this instance's entries from registry
  async function removeFromRegistry(registryPath: string): Promise<void> {
    try {
      const content = await fs.readFile(registryPath, "utf-8");
      const registry = JSON.parse(content);

      // Get current port
      const address = server.address() as net.AddressInfo;
      if (!address) return;

      // Remove all entries that point to this instance's port
      for (const [workspace, port] of Object.entries(registry)) {
        if (port === address.port) {
          delete registry[workspace];
        }
      }

      // Write updated registry back to file
      await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
    } catch (error) {
      // If file doesn't exist, nothing to clean up
      console.log(`MCP Companion: No registry to clean up at ${registryPath}`);
    }
  }

  server.listen(0, "127.0.0.1", async () => {
    const address = server.address() as net.AddressInfo;
    const portRegistryFile = path.join(
      os.tmpdir(),
      "ag-vscode-mcp-extension-registry.json"
    );
    const altPortRegistryFile = "/tmp/ag-vscode-mcp-extension-registry.json";

    console.log("MCP Companion: Server listening on port", address.port);
    console.log(
      "MCP Companion: Updating port registry at",
      portRegistryFile,
      "and",
      altPortRegistryFile
    );

    try {
      // Get the current workspace folders
      const workspaceFolders =
        vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ||
        [];

      // If no workspace is open, use a special identifier
      const workspaceKeys =
        workspaceFolders.length > 0
          ? workspaceFolders
          : ["no-workspace-" + process.pid];

      // Update both registry files
      await Promise.all([
        updatePortRegistry(portRegistryFile, workspaceKeys, address.port),
        updatePortRegistry(altPortRegistryFile, workspaceKeys, address.port),
      ]);

      console.log("MCP Companion: Port registry files updated successfully");
    } catch (error: unknown) {
      console.error(
        "MCP Companion: Error updating port registry files:",
        error
      );
    }
  });

  // Also register a handler to update the registry when workspaces change
  const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(
    async (event) => {
      const address = server.address() as net.AddressInfo;
      if (!address) return;

      const portRegistryFile = path.join(
        os.tmpdir(),
        "ag-vscode-mcp-extension-registry.json"
      );
      const altPortRegistryFile = "/tmp/ag-vscode-mcp-extension-registry.json";

      const workspaceFolders =
        vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ||
        [];
      const workspaceKeys =
        workspaceFolders.length > 0
          ? workspaceFolders
          : ["no-workspace-" + process.pid];

      try {
        await Promise.all([
          updatePortRegistry(portRegistryFile, workspaceKeys, address.port),
          updatePortRegistry(altPortRegistryFile, workspaceKeys, address.port),
        ]);
        console.log(
          "MCP Companion: Port registry updated after workspace change"
        );
      } catch (error) {
        console.error(
          "MCP Companion: Error updating port registry after workspace change:",
          error
        );
      }
    }
  );

  // Add the watcher to context.subscriptions
  context.subscriptions.push(workspaceWatcher);

  // Also clean up registry entries when extension is deactivated
  context.subscriptions.push({
    dispose: async () => {
      console.log("MCP Companion: Cleaning up registry entries");
      const portRegistryFile = path.join(
        os.tmpdir(),
        "ag-vscode-mcp-extension-registry.json"
      );
      const altPortRegistryFile = "/tmp/ag-vscode-mcp-extension-registry.json";

      try {
        await Promise.all([
          removeFromRegistry(portRegistryFile),
          removeFromRegistry(altPortRegistryFile),
        ]);
      } catch (error) {
        console.error(
          "MCP Companion: Error cleaning up registry entries:",
          error
        );
      }

      server.close();
    },
  });

  console.log("MCP Companion extension activated");
}
