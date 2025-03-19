import * as vscode from 'vscode'
import { BaseResponse, DiffResponse } from './types'

/**
 * Manages the diff view state and UI elements
 */
export class DiffManager {
  private resolveChoice: ((accepted: boolean) => void) | undefined
  private acceptButton: vscode.StatusBarItem | undefined
  private rejectButton: vscode.StatusBarItem | undefined
  private originalFilePath: string | undefined

  constructor(private readonly context: vscode.ExtensionContext) {
    this.registerCommands()
  }

  /**
   * Register the accept and reject commands
   */
  private registerCommands(): void {
    // Accept changes command
    const acceptDisposable = vscode.commands.registerCommand('mcp.acceptChanges', async () => this.handleChoice(true))

    // Reject changes command
    const rejectDisposable = vscode.commands.registerCommand('mcp.rejectChanges', async () => this.handleChoice(false))

    // Add to subscriptions
    this.context.subscriptions.push(acceptDisposable, rejectDisposable)
  }

  /**
   * Handle user choice (accept or reject)
   * @param accepted Whether changes were accepted
   */
  private async handleChoice(accepted: boolean): Promise<void> {
    if (!this.resolveChoice) return

    // Call the resolve function
    this.resolveChoice(accepted)

    // Clean up UI elements
    this.acceptButton?.dispose()
    this.rejectButton?.dispose()

    // Close the active diff editor
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

    // Open the original file if we have its path
    if (this.originalFilePath) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(this.originalFilePath))
      await vscode.window.showTextDocument(document)
      this.originalFilePath = undefined
    }

    // Reset state
    this.resolveChoice = undefined
  }

  /**
   * Show a diff view and wait for user choice
   * @param originalPath Path to original file
   * @param modifiedPath Path to modified file
   * @param title Title for the diff view
   * @returns Promise resolving to user's choice
   */
  public async showDiff(originalPath: string, modifiedPath: string, title: string): Promise<boolean> {
    console.log('MCP Companion: Showing diff:', {
      originalPath,
      modifiedPath,
      title,
    })

    // Store the original file path for later use
    this.originalFilePath = originalPath

    // Create accept/reject buttons
    this.acceptButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.acceptButton.text = '$(check) Accept Changes'
    this.acceptButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    this.acceptButton.command = 'mcp.acceptChanges'

    this.rejectButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
    this.rejectButton.text = '$(x) Reject Changes'
    this.rejectButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')
    this.rejectButton.command = 'mcp.rejectChanges'

    // Create a promise that will resolve when the user makes a choice
    const choice = new Promise<boolean>(resolve => {
      this.resolveChoice = resolve
    })

    // Show buttons
    this.acceptButton.show()
    this.rejectButton.show()

    // Show diff
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(originalPath),
      vscode.Uri.file(modifiedPath),
      `${title} (Review Changes)`
    )

    // Wait for user choice
    return choice
  }

  /**
   * Create a response object based on user's choice
   * @param accepted Whether changes were accepted
   * @returns Response object
   */
  public createDiffResponse(accepted: boolean): DiffResponse {
    return {
      success: true,
      accepted,
    }
  }
}
