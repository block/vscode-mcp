#!/usr/bin/env node

import { startServer } from "./index.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the installation directory based on the OS
function getInstallDir(): string {
  // This function can be removed if we don't need an install directory
  return "";
}

// Create the installation directory if it doesn't exist
async function ensureInstallDir(installDir: string): Promise<void> {
  // No longer needed
}

// Copy the compiled server file to the installation directory
async function installServer(): Promise<void> {
  try {
    console.log("📦 Installing vscode-mcp-server globally...");

    // Install the package globally
    const { execSync } = await import("child_process");
    execSync("npm install -g vscode-mcp-server", { stdio: "inherit" });

    console.log("✅ vscode-mcp-server installed globally");

    return;
  } catch (error) {
    console.error("❌ Failed to install vscode-mcp-server globally:", error);
    console.error(
      "⚠️  Sometimes a VPN connection can block access to NPM Registry"
    );
    throw error;
  }
}

async function updateClaudeConfig(): Promise<void> {
  try {
    console.log("\n🔄 Updating Claude configuration...");

    const homedir = os.homedir();
    const platform = os.platform();

    let claudeConfigPath: string;

    if (platform === "win32") {
      claudeConfigPath = path.join(
        homedir,
        "AppData",
        "Roaming",
        "Claude",
        "claude_desktop_config.json"
      );
    } else if (platform === "darwin") {
      claudeConfigPath = path.join(
        homedir,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json"
      );
    } else {
      // Fallback for other platforms
      claudeConfigPath = path.join(homedir, ".config", "claude", "config.json");
    }

    // Check if Claude config directory exists
    const claudeConfigDir = path.dirname(claudeConfigPath);

    // Check if Claude is likely installed by looking for its config directory
    const claudeAppDir = path.dirname(claudeConfigDir);
    if (!fs.existsSync(claudeAppDir)) {
      console.warn("Warning: Claude app directory not found at", claudeAppDir);
      console.warn("Claude does not appear to be installed on this system.");
      console.warn("Skipping Claude configuration update.");
      return; // Exit the function without creating the config
    }

    if (!fs.existsSync(claudeConfigDir)) {
      console.log("Claude config directory not found, creating it...");
      await fsPromises.mkdir(claudeConfigDir, { recursive: true });
    }

    // Read existing config or create new one
    let config: any = {};
    if (fs.existsSync(claudeConfigPath)) {
      const configContent = await fsPromises.readFile(
        claudeConfigPath,
        "utf-8"
      );
      try {
        config = JSON.parse(configContent);
        // console.log("Found existing Claude config file");
      } catch (e) {
        console.log("🔄 Error parsing Claude config, creating new one");
      }
    } else {
      console.log("🔄 Claude config file not found, creating new one");
    }

    // Add or update VS Code extension
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    config.mcpServers["vscode-mcp-server"] = {
      command: "npx",
      args: ["vscode-mcp-server"],
      env: {
        PROJECTS_BASE_DIR: "",
      },
    };

    // Write updated config
    await fsPromises.writeFile(
      claudeConfigPath,
      JSON.stringify(config, null, 2)
    );
    console.log("✅ Updated Claude configuration at", claudeConfigPath);
  } catch (error) {
    console.error("❌ Failed to update Claude config:", error);
  }
}

async function updateGooseConfig(): Promise<void> {
  try {
    console.log("\n🔄 Updating Goose configuration...");

    const homedir = os.homedir();
    const gooseConfigPath = path.join(
      homedir,
      ".config",
      "goose",
      "config.yaml"
    );

    // Check if Goose config directory exists
    const gooseConfigDir = path.dirname(gooseConfigPath);

    // Check if the ~/.config/goose directory exists
    if (!fs.existsSync(gooseConfigDir)) {
      console.warn("Warning: Goose directory not found at", gooseConfigDir);
      console.warn("Goose does not appear to be installed on this system.");
      console.warn("Skipping Goose configuration update.");
      return; // Exit the function without creating the config
    }

    // Read existing config or create new one
    let config: any = { extensions: {} };
    if (fs.existsSync(gooseConfigPath)) {
      const YAML = await import("yaml");
      const configContent = await fsPromises.readFile(gooseConfigPath, "utf-8");
      try {
        config = YAML.parse(configContent) || { extensions: {} };
        // console.log("Found existing Goose config file");
      } catch (e) {
        console.log("🔄 Error parsing Goose config, creating new one");
      }
    } else {
      console.log("🔄 Goose config file not found, creating new one");
    }

    // Add or update VS Code extension
    if (!config.extensions) {
      config.extensions = {};
    }

    config.extensions["vscode-mcp-server"] = {
      name: "VS Code MCP Server",
      cmd: "npx",
      args: ["vscode-mcp-server"],
      enabled: true,
      type: "stdio",
    };

    // Write updated config
    const YAML = await import("yaml");
    await fsPromises.writeFile(
      gooseConfigPath,
      YAML.stringify(config, {
        collectionStyle: "block", // classic YAML style
      })
    );
    console.log("✅ Updated Goose configuration at", gooseConfigPath);
  } catch (error) {
    console.error("❌ Failed to update Goose config:", error);
  }
}

async function generateGooseUrl(): Promise<string> {
  try {
    // Get the package name
    const packageName = "vscode-mcp-server";

    // Generate the Goose URL using npx
    const gooseUrl = `goose://extension?cmd=npx&arg=${encodeURIComponent(
      packageName
    )}&id=vscode-mcp-server&name=VS%20Code%20MCP%20Server&description=Allows%20interacting%20with%20VS%20Code%20from%20Goose`;

    return gooseUrl;
  } catch (error) {
    console.error("❌ Failed to generate Goose URL:", error);
    throw error;
  }
}

// Main CLI function
async function main() {
  const argv = await yargs(hideBin(process.argv))
    .command("install", "Install VS Code MCP Server", {}, async () => {
      console.log("\n🚀 Starting VS Code MCP Server installation...\n");

      await installServer();
      await updateClaudeConfig();
      await updateGooseConfig();

      // Generate and display the Goose URL
      const gooseUrl = await generateGooseUrl();

      console.log("\n✨ Installation complete! ✨");
      console.log(
        "\n🐦 To add this extension to Goose, copy and paste the following URL into your browser 🐦"
      );
      console.log(`\n\x1b[1m${gooseUrl}\x1b[0m\n`);
    })
    .command(
      "install-agents",
      "Install VS Code MCP Server Agents",
      {},
      async () => {
        console.log(
          "\n🚀 Configuring AI assistants for VS Code MCP Server...\n"
        );

        await updateClaudeConfig();
        await updateGooseConfig();

        console.log("\n✨ Goose and Claude agent installation complete! ✨\n");
      }
    )
    .command("update", "Update VS Code MCP Server", {}, async () => {
      console.log("\n🔄 Updating VS Code MCP Server...\n");

      await installServer();
      await updateClaudeConfig();
      await updateGooseConfig();

      console.log("\n✨ Update complete! ✨\n");
    })
    .command("$0", "Start the VS Code MCP Server", {}, () => {
      // Use stderr instead of stdout for logs
      console.error("\n🚀 Starting VS Code MCP Server...");

      // Start the server without any console logs after
      startServer();

      // These logs will also cause problems if they go to stdout
      console.error("✅ VS Code MCP Server started successfully!");
      console.error("⚠️  Press Ctrl+C to stop the server.\n");
    })
    .command(
      "get-goose-url",
      "Get Goose URL for the installed server",
      {},
      async () => {
        console.log("\n🔍 Getting Goose URL for VS Code MCP Server...");
        const gooseUrl = await generateGooseUrl();
        console.log("\n🦢 Goose URL for VS Code MCP Server:");
        console.log(`\n\x1b[1m${gooseUrl}\x1b[0m\n`);
      }
    )
    .help().argv;
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
