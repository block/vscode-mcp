import * as vscode from 'vscode'
import * as path from 'path'
import { EditorUtils } from './editorUtils'

/**
 * Tree data provider for showing context-included files
 */
class ContextFilesProvider implements vscode.TreeDataProvider<vscode.Uri> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.Uri | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  constructor(private contextTracker: ContextTracker) {}
  
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  
  getTreeItem(element: vscode.Uri): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      path.basename(element.fsPath),
      vscode.TreeItemCollapsibleState.None
    );
    treeItem.description = path.dirname(element.fsPath);
    treeItem.tooltip = element.fsPath;
    treeItem.command = {
      command: 'vscode.open',
      arguments: [element],
      title: 'Open File'
    };
    treeItem.contextValue = 'contextFile';
    treeItem.iconPath = new vscode.ThemeIcon('symbol-file');
    
    return treeItem;
  }
  
  getChildren(element?: vscode.Uri): vscode.Uri[] {
    if (element) {
      return [];
    }
    
    // Convert included file paths to Uri objects
    return this.contextTracker.getIncludedFiles().map(file => vscode.Uri.file(file));
  }
}

/**
 * Manages file tabs that are marked for inclusion in AI context
 */
export class ContextTracker {
  private context: vscode.ExtensionContext
  private includedFiles: Set<string> = new Set()
  private decorationType: vscode.TextEditorDecorationType
  private treeDataProvider: ContextFilesProvider
  private statusBarItem: vscode.StatusBarItem
  private _disposables: vscode.Disposable[] = []
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context
    
    // Log startup for debugging
    console.log('ContextTracker initializing...');
    
    // Create decoration type for included files
    this.decorationType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor('terminal.ansiGreen'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true
    })
    
    // Create tree view for context files
    this.treeDataProvider = new ContextFilesProvider(this);
    context.subscriptions.push(
      vscode.window.createTreeView('contextFilesExplorer', {
        treeDataProvider: this.treeDataProvider,
        showCollapseAll: false,
        canSelectMany: false
      })
    );
    
    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'mcp-companion.showContextFiles';
    context.subscriptions.push(this.statusBarItem);
    this.updateStatusBar();
    this.statusBarItem.show();
    
    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('mcp-companion.toggleFileContext', (uri?: vscode.Uri) => {
        console.log('Toggle file context command triggered');
        if (!uri) {
          const activeEditor = EditorUtils.getWorkspaceActiveEditor();
          if (activeEditor) {
            uri = activeEditor.document.uri;
          }
        }
        
        if (uri) {
          // Simply toggle the context state
          this.toggleFileContext(uri);
        }
      }),
      
      vscode.commands.registerCommand('mcp-companion.toggleFileContextOn', (uri?: vscode.Uri) => {
        console.log('Toggle file context (on→off) command triggered');
        if (!uri) {
          const activeEditor = EditorUtils.getWorkspaceActiveEditor();
          if (activeEditor) {
            uri = activeEditor.document.uri;
          }
        }
        
        if (uri) {
          this.removeFromContext(uri)
        }
      }),
      
      vscode.commands.registerCommand('mcp-companion.alwaysVisibleToggle', () => {
        console.log('Always visible toggle command triggered');
        const activeEditor = EditorUtils.getWorkspaceActiveEditor();
        if (activeEditor) {
          const uri = activeEditor.document.uri;
          this.toggleFileContext(uri);
        } else {
          vscode.window.showInformationMessage('No active file to toggle AI context');
        }
      }),
      
      vscode.commands.registerCommand('mcp-companion.includeInContext', (uri?: vscode.Uri) => {
        console.log('Include in context command triggered');
        if (!uri) {
          const activeEditor = EditorUtils.getWorkspaceActiveEditor();
          if (activeEditor) {
            uri = activeEditor.document.uri;
          }
        }
        
        if (uri) {
          this.addToContext(uri)
        }
      }),
      
      vscode.commands.registerCommand('mcp-companion.excludeFromContext', (uri?: vscode.Uri) => {
        console.log('Exclude from context command triggered');
        if (!uri) {
          const activeEditor = EditorUtils.getWorkspaceActiveEditor();
          if (activeEditor) {
            uri = activeEditor.document.uri;
          }
        }
        
        if (uri) {
          this.removeFromContext(uri)
        }
      }),
      
      vscode.commands.registerCommand('mcp-companion.debugContextInfo', () => {
        console.log('Debug context info command triggered');
        const activeEditor = EditorUtils.getWorkspaceActiveEditor();
        if (activeEditor) {
          const filePath = activeEditor.document.uri.fsPath;
          const isIncluded = this.includedFiles.has(filePath);
          
          // Show detailed debug info
          vscode.window.showInformationMessage(
            `Debug Info:\n` +
            `File: ${filePath}\n` +
            `Is included: ${isIncluded}\n` +
            `Total files in context: ${this.includedFiles.size}`
          );
          
          // Force update the context value
          this.updateContextForEditor(activeEditor);
        } else {
          vscode.window.showInformationMessage('No active editor to debug');
        }
      }),
      
      vscode.commands.registerCommand('mcp-companion.showContextFiles', () => {
        vscode.commands.executeCommand('mcp-sidebar.focus');
      }),
      
      vscode.commands.registerCommand('mcp-companion.removeFromContext', (uri: vscode.Uri) => {
        this.removeFromContext(uri);
      }),
      
      vscode.commands.registerCommand('mcp-companion.clearAllContext', () => {
        this.clearAllContext();
      })
    )
    
    // Load previously included files from storage
    const savedFiles = context.workspaceState.get<string[]>('contextIncludedFiles', []);
    console.log(`Loaded ${savedFiles.length} files from storage`);
    savedFiles.forEach(file => this.includedFiles.add(file));
    
    // Set up editor decorations
    this.updateAllEditorDecorations();
    
    // Update context variables for all editors when starting up
    this.updateContextForAllEditors();
    
    // Listen for editor changes
    this.registerEditorListeners();
    
    // Register a basic file system watcher to handle deleted files
    const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
    context.subscriptions.push(
      watcher.onDidDelete(uri => {
        const filePath = uri.fsPath;
        if (this.includedFiles.has(filePath)) {
          console.log(`File was deleted, removing from context: ${filePath}`);
          this.includedFiles.delete(filePath);
          this.saveContextFiles();
          this.treeDataProvider.refresh();
          this.updateStatusBar();
        }
      })
    );
    
    // Initial update of context for all editors
    setTimeout(() => this.updateContextForAllEditors(), 1000);
  }
  
  /**
   * Listen for changes in visible editors
   */
  private registerEditorListeners(): void {
    // Register editor change listener
    this._disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.updateAllEditorDecorations()
        this.updateContextForAllEditors()
      }),
      
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.updateAllEditorDecorations()
        this.updateStatusBar()
        if (editor) {
          this.updateContextForEditor(editor)
        }
      })
    )
  }
  
  /**
   * Updates context variable for all currently visible editors
   */
  private updateContextForAllEditors(): void {
    console.log('Updating context for all editors...');
    EditorUtils.getWorkspaceEditors().forEach(editor => {
      this.updateContextForEditor(editor);
    });
    
    // Also update for active editor specifically (may not be in visible editors)
    const activeEditor = EditorUtils.getWorkspaceActiveEditor();
    if (activeEditor) {
      this.updateContextForEditor(activeEditor);
    }
  }
  
  /**
   * Updates the VS Code context variable for a specific editor
   */
  private updateContextForEditor(editor: vscode.TextEditor): void {
    const filePath = editor.document.uri.fsPath;
    const isIncluded = this.includedFiles.has(filePath);
    
    console.log(`Setting context for ${path.basename(filePath)}: mcp-companion:fileInContext = ${isIncluded}`);
    
    // This is the critical line that controls button visibility
    vscode.commands.executeCommand('setContext', 'mcp-companion:fileInContext', isIncluded);
  }
  
  /**
   * Adds a file to the AI context
   */
  private addToContext(uri: vscode.Uri): void {
    const filePath = uri.fsPath;
    
    if (!this.includedFiles.has(filePath)) {
      console.log(`Adding file to context: ${filePath}`);
      this.includedFiles.add(filePath);
      this.saveContextFiles();
      this.updateUIAfterContextChange(filePath, true);
    }
  }
  
  /**
   * Removes a file from the AI context
   */
  private removeFromContext(uri: vscode.Uri): void {
    const filePath = uri.fsPath;
    
    if (this.includedFiles.has(filePath)) {
      console.log(`Removing file from context: ${filePath}`);
      this.includedFiles.delete(filePath);
      this.saveContextFiles();
      this.updateUIAfterContextChange(filePath, false);
    }
  }
  
  /**
   * Updates all UI elements after a context change
   */
  private updateUIAfterContextChange(filePath: string, added: boolean): void {
    console.log(`Updating UI after context change for ${filePath}, added: ${added}`);
    
    // Update decorations
    this.updateAllEditorDecorations();
    
    // Update status bar indicator
    this.updateStatusBarForFile(filePath);
    
    // Refresh the tree view
    this.treeDataProvider.refresh();
    
    // Update status bar counter
    this.updateStatusBar();
    
    // Update context for all editors to catch any that might be showing this file
    this.updateContextForAllEditors();
    
    // Show feedback to the user
    const fileName = path.basename(filePath);
    const action = added ? 'included in' : 'excluded from';
    vscode.window.showInformationMessage(`${fileName} ${action} AI context`);
  }
  
  /**
   * Saves context files to persistent storage
   */
  private saveContextFiles(): void {
    this.context.workspaceState.update(
      'contextIncludedFiles', 
      Array.from(this.includedFiles)
    );
  }
  
  /**
   * Toggles whether a file is included in the AI context
   */
  public async toggleFileContext(uri?: vscode.Uri): Promise<void> {
    // Use active editor if no URI is provided
    if (!uri) {
      const activeEditor = EditorUtils.getWorkspaceActiveEditor();
      if (activeEditor) {
        uri = activeEditor.document.uri;
      } else {
        // No active editor to work with
        vscode.window.showErrorMessage('No file is currently open');
        return;
      }
    }
    
    const filePath = uri.fsPath;
    const isIncluded = this.includedFiles.has(filePath);
    
    if (isIncluded) {
      this.removeFromContext(uri);
    } else {
      this.addToContext(uri);
    }
  }
  
  /**
   * Updates the status bar with context count
   */
  private updateStatusBar(): void {
    const count = this.includedFiles.size;
    this.statusBarItem.text = `$(symbol-file) AI Context: ${count} file${count === 1 ? '' : 's'}`;
    this.statusBarItem.tooltip = 'Click to show AI context files';
  }
  
  /**
   * Updates status bar and decoration for a specific file
   * @param filePath The file path to update for
   */
  private async updateStatusBarForFile(filePath: string): Promise<void> {
    const isIncluded = this.isFileIncluded(filePath)
    
    // Get editors showing this file
    const editors = EditorUtils.getEditorsForFile(filePath);
    
    if (editors.length === 0) {
      return
    }
    
    // Update decorations for each editor showing this file
    editors.forEach(editor => {
      if (isIncluded) {
        // Apply decorations for included files
        const firstLineRange = new vscode.Range(0, 0, 0, 0)
        editor.setDecorations(this.decorationType, [firstLineRange])
      } else {
        // Clear decorations for files that are no longer included
        editor.setDecorations(this.decorationType, [])
      }
    })
  }
  
  /**
   * Update decorations for all open editors
   */
  private updateAllEditorDecorations(): void {
    const editors = EditorUtils.getWorkspaceEditors();
    
    // Update decorations for each editor
    editors.forEach(editor => {
      const filePath = editor.document.uri.fsPath
      const isIncluded = this.isFileIncluded(filePath)
      
      if (isIncluded) {
        // Apply decorations for included files
        const firstLineRange = new vscode.Range(0, 0, 0, 0)
        editor.setDecorations(this.decorationType, [firstLineRange])
      } else {
        // Clear decorations for files that are no longer included
        editor.setDecorations(this.decorationType, [])
      }
    })
  }
  
  /**
   * Gets all files currently marked for inclusion in AI context
   */
  public getIncludedFiles(): string[] {
    return Array.from(this.includedFiles)
  }
  
  /**
   * Checks if a file is marked for inclusion in AI context
   */
  public isFileIncluded(filePath: string): boolean {
    return this.includedFiles.has(filePath)
  }
  
  /**
   * Clears all context-included files
   */
  private clearAllContext(): void {
    this.includedFiles.clear();
    
    // Save to persistent storage
    this.context.workspaceState.update(
      'contextIncludedFiles', 
      []
    );
    
    // Update decorations
    this.updateAllEditorDecorations();
    
    // Refresh the tree view
    this.treeDataProvider.refresh();
    
    // Update status bar
    this.updateStatusBar();
    
    vscode.window.showInformationMessage('All files removed from AI context');
  }
  
  /**
   * Adds a file to be included in AI context
   * @param uri The URI of the file to add, or undefined to use active editor
   */
  public async addFileToContext(uri?: vscode.Uri): Promise<void> {
    // Use active editor if no URI is provided
    if (!uri) {
      const activeEditor = EditorUtils.getWorkspaceActiveEditor();
      if (activeEditor) {
        uri = activeEditor.document.uri;
      } else {
        // No active editor to work with
        vscode.window.showErrorMessage('No file is currently open');
        return;
      }
    }
    
    this.addToContext(uri);
  }
  
  /**
   * Shows the context files view
   */
  public showContextFiles(): void {
    // Focus the context files explorer
    vscode.commands.executeCommand('mcp-sidebar.focus');
  }
  
  /**
   * Removes a file from being included in AI context
   * @param uri The URI of the file to remove, or undefined to use active editor
   */
  public async removeFileFromContext(uri?: vscode.Uri): Promise<void> {
    // Use active editor if no URI is provided
    if (!uri) {
      const activeEditor = EditorUtils.getWorkspaceActiveEditor();
      if (activeEditor) {
        uri = activeEditor.document.uri;
      } else {
        // No active editor to work with
        vscode.window.showErrorMessage('No file is currently open');
        return;
      }
    }
    
    this.removeFromContext(uri);
  }
  
  /**
   * Clears all files from the AI context
   */
  public async clearContext(): Promise<void> {
    this.clearAllContext();
  }
} 