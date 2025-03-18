import * as vscode from 'vscode'
import { DiffManager } from './diffManager'
import { CommandHandler } from './commandHandler'
import { SocketServer } from './socketServer'

/**
 * Activates the extension
 * @param context The extension context
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('MCP Companion extension activating...')

  // Initialize the components
  const diffManager = new DiffManager(context)
  const commandHandler = new CommandHandler(diffManager)
  const socketServer = new SocketServer(commandHandler, context)

  // Start the socket server
  await socketServer.start()

  console.log('MCP Companion extension activated')
}

// No deactivate function needed as cleanup is handled by disposables
