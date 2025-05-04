import * as vscode from 'vscode'
import * as net from 'net'
import * as cp from 'child_process'
import { promisify } from 'util'
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
  ExecuteShellCommand,
  GetCompletionsCommand,
  CompletionsResponse,
} from './types'
import { DiffManager } from './diffManager'
import { SettingsManager } from './settingsManager'
import { ContextTracker } from './contextTracker'
import { EditorUtils } from './editorUtils'

const exec = promisify(cp.exec)

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
  executeShellCommand: (command: ExecuteShellCommand) => Promise<BaseResponse>
  getCompletions: (command: GetCompletionsCommand) => Promise<CompletionsResponse>
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
    this.registerHandler('executeShellCommand', this.handleExecuteShellCommand.bind(this))
    this.registerHandler('getCompletions', this.handleGetCompletions.bind(this))
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
      } else if (command.type === 'executeShellCommand' && !settings.shellCommands.enabled) {
        console.log('MCP Companion: Shell command execution is disabled in settings')
        response = {
          success: false,
          error: 'Shell command execution is disabled in MCP settings',
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
  private async handleGetActiveTabs(command: {
    type: 'getActiveTabs'
    includeContent?: boolean
  }): Promise<ActiveTabsResponse> {
    try {
      // Get editors from the current workspace only
      const editors = EditorUtils.getWorkspaceEditors()
      const activeEditor = EditorUtils.getWorkspaceActiveEditor()

      // Process each editor to gather information
      const tabs = await Promise.all(
        Array.from(editors).map(async editor => {
          const document = editor.document
          const isActive = editor === activeEditor
          const filePath = document.uri.fsPath

          // Create tab info object
          const tabInfo: {
            filePath: string
            isActive: boolean
            languageId?: string
            content?: string
            workspaceFolder?: string
          } = {
            filePath,
            isActive,
            languageId: document.languageId,
          }

          // Include content if requested
          if (command.includeContent) {
            tabInfo.content = document.getText()
          }

          // Add workspace folder info
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
          if (workspaceFolder) {
            tabInfo.workspaceFolder = workspaceFolder.uri.fsPath
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
        error: `Error getting active tabs: ${error}`,
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

      if (includedFiles.length === 0 && (!command.selections || command.selections.length === 0)) {
        return {
          success: true,
          tabs: [],
        }
      }

      // Get workspace editors only
      const editors = EditorUtils.getWorkspaceEditors()
      const activeEditor = EditorUtils.getWorkspaceActiveEditor()

      // Map of file paths to document instances
      const openDocuments = new Map<string, vscode.TextDocument>()

      // First collect all open documents
      Array.from(editors).forEach(editor => {
        openDocuments.set(editor.document.uri.fsPath, editor.document)
      })

      // Only process files that are in the current workspace
      const workspaceFolders = vscode.workspace.workspaceFolders || []
      const workspacePaths = workspaceFolders.map(folder => folder.uri.fsPath)

      // Create a combined set of files to process - both from context tracker and selections
      const filesToProcess = new Set<string>(includedFiles)
      
      // Add files from selections parameter
      if (command.selections && command.selections.length > 0) {
        command.selections.forEach(selection => {
          filesToProcess.add(selection.filePath)
        })
      }

      // Filter files to only those in the current workspace
      const workspaceFiles = Array.from(filesToProcess).filter(filePath =>
        workspacePaths.some(wsPath => filePath === wsPath || filePath.startsWith(wsPath + require('path').sep))
      )

      // Create a map of file paths to their line range selections
      const fileSelections = new Map<string, Array<{startLine: number; endLine: number}>>()
      
      // Add selections from command parameter
      if (command.selections) {
        command.selections.forEach(selection => {
          if (selection.ranges && selection.ranges.length > 0) {
            fileSelections.set(selection.filePath, selection.ranges)
          }
        })
      }
      
      // Add stored line ranges from contextTracker
      for (const filePath of workspaceFiles) {
        // Skip if already set from command parameter
        if (fileSelections.has(filePath)) {
          continue
        }
        
        // Get stored line ranges if any
        const storedRanges = this.contextTracker.getLineRanges(filePath)
        if (storedRanges && storedRanges.length > 0) {
          fileSelections.set(filePath, storedRanges)
        }
      }

      // Process files, loading them if needed
      const tabs = await Promise.all(
        workspaceFiles.map(async filePath => {
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
            selectedContent?: string
            lineRanges?: Array<{startLine: number; endLine: number}>
            workspaceFolder?: string
          } = {
            filePath,
            isActive: activeEditor?.document.uri.fsPath === filePath,
            isOpen,
            languageId: document.languageId,
          }

          // Add line range information if available
          const lineRanges = fileSelections.get(filePath)
          if (lineRanges) {
            tabInfo.lineRanges = lineRanges
            
            // If content is requested, extract the selected lines
            if (command.includeContent) {
              const textLines = document.getText().split('\n')
              
              // Extract the text from the selected line ranges
              const selectedTextParts = lineRanges.map(range => {
                // Adjust for 0-based array indexing vs 1-based line numbers
                const start = Math.max(0, range.startLine - 1)
                const end = Math.min(textLines.length - 1, range.endLine - 1)
                
                return textLines.slice(start, end + 1).join('\n')
              })
              
              tabInfo.selectedContent = selectedTextParts.join('\n\n// ----- Next Range ----- //\n\n')
            }
          } 
          // Include full content if requested and no line ranges specified
          else if (command.includeContent) {
            tabInfo.content = document.getText()
          }

          // Add workspace folder info
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
          if (workspaceFolder) {
            tabInfo.workspaceFolder = workspaceFolder.uri.fsPath
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
        selectedContent?: string
        lineRanges?: Array<{startLine: number; endLine: number}>
        workspaceFolder?: string
      }>

      return {
        success: true,
        tabs: validTabs,
      }
    } catch (error) {
      console.error('Error getting context tabs:', error)
      return {
        success: false,
        error: `Error getting context tabs: ${error}`,
      }
    }
  }

  /**
   * Handle the executeShellCommand command
   */
  private async handleExecuteShellCommand(command: ExecuteShellCommand): Promise<BaseResponse> {
    const { command: shellCommand, cwd } = command
    console.log('MCP Companion: Executing shell command:', shellCommand, { cwd })

    try {
      // Execute the command using child_process
      const { stdout, stderr } = await exec(shellCommand, { cwd })

      // Create or get the terminal to show the command execution
      let terminal = vscode.window.activeTerminal
      if (!terminal) {
        terminal = vscode.window.createTerminal('MCP Shell')
      }

      // Show the command execution in the terminal
      if (cwd) {
        terminal.sendText(`cd "${cwd}"`)
      }
      terminal.sendText(shellCommand)
      terminal.show()

      // Return the combined output
      const output = stdout + (stderr ? `\nError: ${stderr}` : '')
      return {
        success: true,
        output: output || 'Command executed but no output captured',
      }
    } catch (error) {
      console.error('MCP Companion: Error executing shell command:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Handle the getCompletions command
   */
  private async handleGetCompletions(command: GetCompletionsCommand): Promise<CompletionsResponse> {
    const { filePath, position, triggerCharacter } = command
    console.log('MCP Companion: Getting completions:', filePath, position, triggerCharacter)

    try {
      // Get document
      const uri = vscode.Uri.file(filePath)
      const document = await vscode.workspace.openTextDocument(uri)
      
      // Convert to VSCode position (0-based)
      const vsCodePosition = new vscode.Position(position.line, position.character)
      
      // Get completions using VSCode API
      const completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        document.uri,
        vsCodePosition,
        triggerCharacter
      )
      
      if (!completionList) {
        return {
          success: true,
          completions: [] // Return empty array if no completions
        }
      }
      
      // Map to our simpler format
      const completions = completionList.items.map(item => ({
        label: typeof item.label === 'string' ? item.label : item.label.label,
        insertText: item.insertText?.toString() || undefined,
        detail: item.detail,
        documentation: typeof item.documentation === 'string' 
          ? item.documentation 
          : item.documentation?.value,
        kind: item.kind ? String(item.kind) : undefined
      }))
      
      console.log(`MCP Companion: Found ${completions.length} completions`)
      
      return {
        success: true,
        completions
      }
    } catch (error) {
      console.error('MCP Companion: Error getting completions:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
