import * as vscode from 'vscode'
import { DiffManager } from './diffManager'
import { CommandHandler } from './commandHandler'
import { SocketServer } from './socketServer'
import { SettingsViewProvider } from './settingsView'
import { SettingsManager } from './settingsManager'
import { ContextTracker } from './contextTracker'
import * as path from 'path'

/**
 * Activates the extension
 * @param context The extension context
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('MCP Companion extension activating...')

  // Initialize the settings manager
  const settingsManager = SettingsManager.getInstance(context)

  // Create the context tracker - this will register the context-related commands
  const contextTracker = new ContextTracker(context, context.globalStorageUri.fsPath)

  // Create the diff manager
  const diffManager = new DiffManager(context)

  // Initialize the command handler
  const commandHandler = new CommandHandler(diffManager, contextTracker)

  // Create the socket server
  const socketServer = new SocketServer(commandHandler, context)

  // Register the settings view panel
  const settingsViewProvider = new SettingsViewProvider(context.extensionUri, context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsViewProvider)
  )

  // Start the socket server
  await socketServer.start()

  console.log('MCP Companion extension activated')
}

// No deactivate function needed as cleanup is handled by disposables
