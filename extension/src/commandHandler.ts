import * as vscode from 'vscode'
import * as net from 'net'
import {

  CommandType,
  CommandUnion,
  ShowDiffCommand,
  OpenCommand,
  OpenFolderCommand,
  GetCurrentWorkspaceCommand,
  PingCommand,
  FocusWindowCommand,
  BaseResponse,
  DiffResponse,
  WorkspaceResponse,
  ActiveTabsResponse,
  GetContextTabsCommand,

} from './types'
import { DiffManager } from './diffManager'
import { SettingsManager } from './settingsManager'
import { ContextTracker } from './contextTracker'

// Define a type for command handlers with proper mapping between command types and handler parameter types
type CommandHandlerMap = {
  showDiff: (command: ShowDiffCommand, socket?: net.Socket) => Promise<DiffResponse>
  open: (command: OpenCommand) => Promise<BaseResponse>
  openFolder: (command: OpenFolderCommand) => Promise<BaseResponse>
  getCurrentWorkspace: (command: GetCurrentWorkspaceCommand) => Promise<WorkspaceResponse>
  ping: (command: PingCommand) => BaseResponse
  focusWindow: (command: FocusWindowCommand) => Promise<BaseResponse>
  getActiveTabs: (command: { type: 'getActiveTabs'; includeContent?: boolean }) => Promise<ActiveTabsResponse>
  getContextTabs: (command: GetContextTabsCommand) => Promise<ActiveTabsResponse>
}

/**
 * Handles commands received from the socket
 */
export class CommandHandler {
  // Command handler registry
  private commandHandlers: Partial<CommandHandlerMap> = {}
  private settingsManager: SettingsManager

  private contextTracker: ContextTracker
  
  constructor(private readonly diffManager: DiffManager, contextTracker: ContextTracker) {
    this.settingsManager = SettingsManager.getInstance()
    this.diffManager = diffManager
    this.contextTracker = contextTracker
    this.registerCommandHandlers()
  }

  /**
   * Register all command handlers
   */
  private registerCommandHandlers(): void {
    // Register each command handler
    this.registerHandler('showDiff', this.handleShowDiff.bind(this))
    this.registerHandler('open', this.handleOpen.bind(this))
    this.registerHandler('openFolder', this.handleOpenFolder.bind(this))
    this.registerHandler('getCurrentWorkspace', this.handleGetCurrentWorkspace.bind(this))
    this.registerHandler('ping', this.handlePing.bind(this))
    this.registerHandler('focusWindow', this.handleFocusWindow.bind(this))
    this.registerHandler('getActiveTabs', this.handleGetActiveTabs.bind(this))
    this.registerHandler('getContextTabs', this.handleGetContextTabs.bind(this))
  }

  /**
   * Register a handler for a specific command type
   */
  private registerHandler<T extends CommandType>(type: T, handler: CommandHandlerMap[T]): void {
    this.commandHandlers[type] = handler
  }

  /**
   * Handle a command and return a response
   * @param command The command to handle
   * @param socket The socket to write responses to
   */
  public async handleCommand(command: CommandUnion, socket: net.Socket): Promise<void> {
    try {
      console.log('MCP Companion: Received command:', command)

      let response: BaseResponse

      // Check settings before processing commands
      const settings = this.settingsManager.getSettings()

      // Handle disabled features with auto-responses
      if (command.type === 'showDiff' && !settings.diffing.enabled) {
        console.log('MCP Companion: Diffing is disabled in settings - auto-applying changes')
        vscode.window.showInformationMessage('Diffing is disabled in MCP settings - changes auto-applied')
        response = this.diffManager.createDiffResponse(true)
      } else if (command.type === 'open' && !settings.fileOpening.enabled) {
        console.log('MCP Companion: File opening is disabled in settings')
        response = {
          success: false,
          error: 'File opening is disabled in MCP settings',
        }
      } else {
        // Get the handler for this command type
        const handler = this.commandHandlers[command.type] as Function

        if (handler) {
          // Special case for showDiff which needs the socket
          if (command.type === 'showDiff') {
            response = await handler(command, socket)
          } else {
            response = await handler(command)
          }
        } else {
          // This should never happen with proper typing
          response = {
            success: false,
            error: `Unknown command type: ${command.type}`,
          }
        }
      }

      // Send the response
      socket.write(JSON.stringify(response))
    } catch (error: unknown) {
      console.error('MCP Companion: Error handling command:', error)

      // Send error response
      socket.write(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      )
    }
  }

  /**
   * Handle the showDiff command
   */
  private async handleShowDiff(command: ShowDiffCommand, socket?: net.Socket): Promise<DiffResponse> {
    const { originalPath, modifiedPath, title } = command

    // Show diff and wait for user choice
    const accepted = await this.diffManager.showDiff(originalPath, modifiedPath, title)

    console.log(`MCP Companion: Changes ${accepted ? 'accepted' : 'rejected'}`)
    return this.diffManager.createDiffResponse(accepted)
  }

  /**
   * Handle the open command
   */
  private async handleOpen(command: OpenCommand): Promise<BaseResponse> {
    const { filePath, options } = command
    console.log('MCP Companion: Opening file:', filePath, options)

    try {
      // Convert file path to URI
      const uri = vscode.Uri.file(filePath)

      // Open the document
      const document = await vscode.workspace.openTextDocument(uri)

      // Show the document in the editor
      await vscode.window.showTextDocument(document, options)

      console.log('MCP Companion: File opened successfully')
      return { success: true }
    } catch (error) {
      console.error('MCP Companion: Error opening file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Handle the openFolder command
   */
  private async handleOpenFolder(command: OpenFolderCommand): Promise<BaseResponse> {
    const { folderPath, newWindow } = command
    console.log('MCP Companion: Opening folder:', folderPath, { newWindow })

    try {
      // Convert folder path to URI
      const uri = vscode.Uri.file(folderPath)

      // Use the VS Code API to open the folder
      await vscode.commands.executeCommand('vscode.openFolder', uri, {
        forceNewWindow: newWindow,
      })

      console.log('MCP Companion: Folder opened successfully')
      return { success: true }
    } catch (error) {
      console.error('MCP Companion: Error opening folder:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Handle the getCurrentWorkspace command
   */
  private async handleGetCurrentWorkspace(command: GetCurrentWorkspaceCommand): Promise<WorkspaceResponse> {
    console.log('MCP Companion: Getting current workspace')

    try {
      // Get all open workspaces
      const workspaces = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || []

      console.log('MCP Companion: Sent workspace info')
      return { success: true, workspaces }
    } catch (error) {
      console.error('MCP Companion: Error getting workspace info:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Handle the ping command
   */
  private handlePing(command: PingCommand): BaseResponse {
    console.log('MCP Companion: Received ping')
    return { success: true }
  }

  /**
   * Handle the focusWindow command
   */
  private async handleFocusWindow(command: FocusWindowCommand): Promise<BaseResponse> {
    console.log('MCP Companion: Focusing window')

    try {
      // Focus the VS Code window
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')

      console.log('MCP Companion: Window focused successfully')
      return { success: true }
    } catch (error) {
      console.error('MCP Companion: Error focusing window:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Gets information about all active editor tabs
   * @param command The getActiveTabs command
   * @returns Response with tabs information
   */
  private async handleGetActiveTabs(command: { type: 'getActiveTabs'; includeContent?: boolean }): Promise<ActiveTabsResponse> {
    try {
      // Get all visible editors
      const editors = vscode.window.visibleTextEditors
      const activeEditor = vscode.window.activeTextEditor
      
      // Process each editor to gather information
      const tabs = await Promise.all(
        editors.map(async (editor) => {
          const document = editor.document
          const isActive = editor === activeEditor
          const filePath = document.uri.fsPath
          
          // Create tab info object
          const tabInfo: {
            filePath: string
            isActive: boolean
            languageId?: string
            content?: string
          } = {
            filePath,
            isActive,
            languageId: document.languageId,
          }
          
          // Include content if requested
          if (command.includeContent) {
            tabInfo.content = document.getText()
          }
          
          return tabInfo
        })
      )
      
      return {
        success: true,
        tabs,
      }
    } catch (error) {
      console.error('Error getting active tabs:', error)
      return {
        success: false,
        error: `Error getting active tabs: ${error}`
      }
    }
  }

  /**
   * Gets information about tabs specifically marked for AI context
   * @param command The getContextTabs command
   * @returns Response with context tabs information
   */
  private async handleGetContextTabs(command: GetContextTabsCommand): Promise<ActiveTabsResponse> {
    try {
      // Get included files list
      const includedFiles = this.contextTracker.getIncludedFiles()
      
      if (includedFiles.length === 0) {
        return {
          success: true,
          tabs: [],
        }
      }
      
      // Get all editors
      const editors = vscode.window.visibleTextEditors
      const activeEditor = vscode.window.activeTextEditor
      
      // Map of file paths to document instances
      const openDocuments = new Map<string, vscode.TextDocument>()
      
      // First collect all open documents
      editors.forEach(editor => {
        openDocuments.set(editor.document.uri.fsPath, editor.document)
      })
      
      // Process included files, loading them if needed
      const tabs = await Promise.all(
        includedFiles.map(async (filePath) => {
          let document: vscode.TextDocument
          let isOpen = openDocuments.has(filePath)
          
          // If the file is already open, use that instance
          if (isOpen) {
            document = openDocuments.get(filePath)!
          } else {
            // Otherwise, load it temporarily
            try {
              document = await vscode.workspace.openTextDocument(filePath)
            } catch (error) {
              console.error(`Could not load file: ${filePath}`, error)
              return null
            }
          }
          
          // Create tab info object
          const tabInfo: {
            filePath: string
            isActive: boolean
            isOpen: boolean
            languageId?: string
            content?: string
          } = {
            filePath,
            isActive: activeEditor?.document.uri.fsPath === filePath,
            isOpen,
            languageId: document.languageId,
          }
          
          // Include content if requested
          if (command.includeContent) {
            tabInfo.content = document.getText()
          }
          
          return tabInfo
        })
      )
      
      // Filter out null entries (files that couldn't be loaded)
      const validTabs = tabs.filter(tab => tab !== null) as Array<{
        filePath: string
        isActive: boolean
        isOpen: boolean
        languageId?: string
        content?: string
      }>
      
      return {
        success: true,
        tabs: validTabs,
      }
    } catch (error) {
      console.error('Error getting context tabs:', error)
      return {
        success: false,
        error: `Error getting context tabs: ${error}`
      }
    }
  }
}
