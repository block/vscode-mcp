import * as vscode from 'vscode'
import * as path from 'path'

/**
 * Utility functions for working with VS Code editors
 * while respecting workspace boundaries
 */
export class EditorUtils {
  /**
   * Gets all visible text editors that belong to the current workspace
   * This ensures we don't leak information across different VS Code windows
   */
  public static getWorkspaceEditors(): readonly vscode.TextEditor[] {
    // Get current workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.debug('No workspace folders found, returning all editors');
      return vscode.window.visibleTextEditors;
    }
    
    // Get workspace paths
    const workspacePaths = workspaceFolders.map(folder => folder.uri.fsPath);
    console.debug(`Found ${workspacePaths.length} workspace paths`);
    
    // Filter editors to only those in the current workspace
    return vscode.window.visibleTextEditors.filter(editor => {
      const filePath = editor.document.uri.fsPath;
      
      // Check if this file is within any workspace folder
      const isInWorkspace = workspacePaths.some(wsPath => 
        filePath === wsPath || filePath.startsWith(wsPath + path.sep)
      );
      
      if (!isInWorkspace) {
        console.debug(`Filtered out editor for file outside workspace: ${filePath}`);
      }
      
      return isInWorkspace;
    });
  }
  
  /**
   * Finds editors for a specific file path, respecting workspace boundaries
   */
  public static getEditorsForFile(filePath: string): readonly vscode.TextEditor[] {
    const workspaceEditors = this.getWorkspaceEditors();
    
    return workspaceEditors.filter(editor => 
      editor.document.uri.fsPath === filePath
    );
  }
  
  /**
   * Checks if the active editor belongs to the current workspace
   */
  public static getWorkspaceActiveEditor(): vscode.TextEditor | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    
    if (!activeEditor) {
      return undefined;
    }
    
    const workspaceEditors = this.getWorkspaceEditors();
    return workspaceEditors.find(editor => editor === activeEditor);
  }
} 