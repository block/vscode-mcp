import * as vscode from 'vscode'
import * as path from 'path'
import { EditorUtils } from './editorUtils'
import * as fs from 'fs'
import { LineRange } from './types'

/**
 * Tree item for file and line range entries in the context explorer
 */
class FileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly type: 'file' | 'lineRange' = 'file',
    public readonly lineRange?: { startLine: number; endLine: number }
  ) {
    super(
      type === 'file' 
        ? path.basename(uri.fsPath) 
        : `Lines ${lineRange!.startLine}-${lineRange!.endLine}`,
      collapsibleState
    );
    
    if (type === 'file') {
      this.contextValue = 'contextFile';
      this.tooltip = uri.fsPath;
      this.description = path.dirname(uri.fsPath);
      this.iconPath = new vscode.ThemeIcon('file');
      
      // Open the file when clicked
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [uri]
      };
    } else if (type === 'lineRange') {
      this.contextValue = 'lineRange';
      this.tooltip = `Lines ${lineRange!.startLine}-${lineRange!.endLine}`;
      this.description = '';
      this.iconPath = new vscode.ThemeIcon('list-selection');
      
      // Add command to reveal this range when clicked
      this.command = {
        command: 'mcp-companion.revealLineRange',
        title: 'Reveal Line Range',
        arguments: [uri, lineRange!.startLine - 1, lineRange!.endLine - 1] // Convert to 0-based for internal use
      };
    }
  }
}

/**
 * Tree data provider for showing context-included files
 */
class ContextFilesProvider implements vscode.TreeDataProvider<FileTreeItem | vscode.Uri> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileTreeItem | vscode.Uri | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  constructor(private contextTracker: ContextTracker) {}
  
  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }
  
  getTreeItem(element: FileTreeItem | vscode.Uri): vscode.TreeItem {
    if (element instanceof FileTreeItem) {
      return element;
    }
    
    // For URI elements, create a file tree item
    const uri = element;
    const hasLineRanges = this.contextTracker.getLineRanges(uri.fsPath);
    
    return new FileTreeItem(
      uri,
      hasLineRanges && hasLineRanges.length > 0 
        ? vscode.TreeItemCollapsibleState.Collapsed 
        : vscode.TreeItemCollapsibleState.None
    );
  }
  
  getChildren(element?: FileTreeItem | vscode.Uri): Thenable<(FileTreeItem | vscode.Uri)[]> {
    if (!element) {
      // Root level - return all included files as URIs
      const fileUris = this.contextTracker.getIncludedFiles().map(file => vscode.Uri.file(file));
      return Promise.resolve(fileUris);
    }
    
    // If we have a FileTreeItem type element that's not a file
    if (element instanceof FileTreeItem && element.type !== 'file') {
      return Promise.resolve([]);
    }
    
    // If we have a file URI or a file type FileTreeItem, return line ranges if any
    const filePath = element instanceof FileTreeItem ? element.uri.fsPath : element.fsPath;
    const lineRanges = this.contextTracker.getLineRanges(filePath);
    
    if (lineRanges && lineRanges.length > 0) {
      const uri = element instanceof FileTreeItem ? element.uri : element;
      return Promise.resolve(
        lineRanges.map(range => 
          new FileTreeItem(
            uri,
            vscode.TreeItemCollapsibleState.None,
            'lineRange',
            range
          )
        )
      );
    }
    
    return Promise.resolve([]);
  }
}

/**
 * CodeLens provider for showing "Add to Goose/Cline" buttons on text selections
 */
class ContextCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    // Refresh CodeLenses when the editor selection changes
    vscode.window.onDidChangeTextEditorSelection(() => {
      this._onDidChangeCodeLenses.fire();
    });
    
    // Also refresh when configuration changes
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('mcp-companion.enableInlineButtons')) {
        this._onDidChangeCodeLenses.fire();
      }
    });
  }

  public provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
    // Check if the feature is enabled in settings
    const config = vscode.workspace.getConfiguration('mcp-companion');
    if (config.get<boolean>('enableInlineButtons') === false) {
      return [];
    }
    
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document || editor.selections.length === 0) {
      return [];
    }

    // Only provide CodeLenses for non-empty selections
    const codeLenses: vscode.CodeLens[] = [];
    
    for (const selection of editor.selections) {
      if (selection.isEmpty) {
        continue;
      }
      
      // Create a range for the entire selection
      const range = new vscode.Range(
        selection.start.line, selection.start.character,
        selection.end.line, selection.end.character
      );
      
      // Add a CodeLens for Goose at the start of the selection
      const gooseLens = new vscode.CodeLens(range);
      gooseLens.command = {
        title: '$(add) Add to Goose',
        command: 'mcp-companion.includeSelectedLinesGoose',
        tooltip: 'Add selected lines to Goose AI context'
      };
      codeLenses.push(gooseLens);
      
      // Add a CodeLens for Cline at the start of the selection
      const clineLens = new vscode.CodeLens(range);
      clineLens.command = {
        title: '$(add) Add to Cline',
        command: 'mcp-companion.includeSelectedLinesCline',
        tooltip: 'Add selected lines to Cline AI context'
      };
      codeLenses.push(clineLens);
    }
    
    return codeLenses;
  }
}

/**
 * Manages file tabs that are marked for inclusion in AI context
 */
export class ContextTracker {
  private context: vscode.ExtensionContext
  private includedFiles: Set<string> = new Set()
  private fileLineRanges: Map<string, LineRange[]> = new Map()
  private decorationType: vscode.TextEditorDecorationType
  private treeDataProvider: ContextFilesProvider
  private statusBarItem: vscode.StatusBarItem
  private _disposables: vscode.Disposable[] = []
  private readonly storageFilePath: string
  
  constructor(context: vscode.ExtensionContext, storagePath: string) {
    this.context = context
    this.storageFilePath = path.join(storagePath, 'included-files.json')
    
    // Log startup for debugging
    console.log('ContextTracker initializing...');
    
    // Create decoration type for included files
    this.decorationType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor('terminal.ansiBlue'),
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
      
      // Original command for backward compatibility
      vscode.commands.registerCommand('mcp-companion.includeSelectedLines', () => {
        console.log('Include selected lines command triggered (generic)');
        this.includeSelectedLinesForAssistant('both');
      }),
      
      // Goose-specific command
      vscode.commands.registerCommand('mcp-companion.includeSelectedLinesGoose', () => {
        console.log('Include selected lines command triggered for Goose');
        this.includeSelectedLinesForAssistant('goose');
      }),
      
      // Cline-specific command
      vscode.commands.registerCommand('mcp-companion.includeSelectedLinesCline', () => {
        console.log('Include selected lines command triggered for Cline');
        this.includeSelectedLinesForAssistant('cline');
      }),
      
      vscode.commands.registerCommand('mcp-companion.clearLineSelections', () => {
        console.log('Clear line selections command triggered');
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
          vscode.window.showWarningMessage('No active file to clear line selections from');
          return;
        }

        const filePath = activeEditor.document.uri.fsPath;
        
        // Clear any line range selections for this file
        this.clearLineRanges(filePath);
        vscode.window.showInformationMessage(`Cleared line selections for ${path.basename(filePath)}`);
      }),
      
      vscode.commands.registerCommand('mcp-companion.revealLineRange', async (uri: vscode.Uri, startLine: number, endLine: number) => {
        try {
          console.log(`Revealing lines ${startLine}-${endLine} in ${uri.fsPath}`);
          
          // Open the document
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document);
          
          // Create a selection from start to end line
          const start = new vscode.Position(startLine - 1, 0); // Convert to 0-based
          const end = new vscode.Position(endLine - 1, document.lineAt(endLine - 1).text.length); // End of line
          
          // Select the range
          editor.selection = new vscode.Selection(start, end);
          
          // Reveal the range in the editor
          editor.revealRange(
            new vscode.Range(start, end),
            vscode.TextEditorRevealType.InCenter
          );
        } catch (error) {
          console.error('Error revealing line range:', error);
          vscode.window.showErrorMessage(`Failed to reveal line range: ${error}`);
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
      }),
      
      vscode.commands.registerCommand('mcp-companion.removeLineRange', this.removeLineRange.bind(this))
    )
    
    // Register the CodeLens provider for "Add to Goose" button
    const codeLensProvider = new ContextCodeLensProvider();
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider('*', codeLensProvider)
    );
    
    // Load previously included files from storage
    this.loadIncludedFiles();
    
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
          this.saveIncludedFiles();
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
      this.saveIncludedFiles();
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
      
      // Also clear any line ranges associated with this file
      this.fileLineRanges.delete(filePath);
      
      this.saveIncludedFiles();
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
  private saveIncludedFiles(): void {
    try {
      // Ensure the directory exists
      const dir = path.dirname(this.storageFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      // Convert map to object for JSON serialization
      const lineRangesObj: Record<string, LineRange[]> = {}
      this.fileLineRanges.forEach((ranges, filePath) => {
        lineRangesObj[filePath] = ranges
      })
      
      // Save both the included files and line ranges
      fs.writeFileSync(
        this.storageFilePath, 
        JSON.stringify({
          files: Array.from(this.includedFiles),
          lineRanges: lineRangesObj
        }, null, 2)
      )
    } catch (error) {
      console.error('Error saving included files:', error)
    }
  }
  
  /**
   * Toggles whether a file is included in the AI context
   * If a URI is provided, it uses that. Otherwise, uses the active editor.
   * @param uri Optional URI to toggle, if not provided uses active editor
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
   * Toggles whether a file is included in the AI context by file path
   * This is a direct method that doesn't perform UI updates
   * @param filePath The path to the file
   * @returns Whether the file is now included
   */
  public toggleFileInclusion(filePath: string): boolean {
    if (this.includedFiles.has(filePath)) {
      this.includedFiles.delete(filePath);
      // Always clear any line ranges for this file when removing
      this.fileLineRanges.delete(filePath);
    } else {
      this.includedFiles.add(filePath);
    }
    
    this.saveIncludedFiles();
    
    // Update UI elements
    this.updateAllEditorDecorations();
    this.updateStatusBarForFile(filePath);
    this.treeDataProvider.refresh();
    this.updateStatusBar();
    this.updateContextForAllEditors();
    
    return this.includedFiles.has(filePath);
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
      this.updateEditorDecorations(editor, filePath, isIncluded);
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
      
      this.updateEditorDecorations(editor, filePath, isIncluded);
    })
  }
  
  /**
   * Updates decorations for a single editor
   * @param editor The editor to update decorations for
   * @param filePath The file path of the editor
   * @param isIncluded Whether the file is included in the context
   */
  private updateEditorDecorations(editor: vscode.TextEditor, filePath: string, isIncluded: boolean): void {
    if (isIncluded) {
      const lineRanges = this.getLineRanges(filePath);
      
      if (lineRanges && lineRanges.length > 0) {
        // If we have specific line ranges, only highlight those
        const decorationRanges = lineRanges.map(range => {
          // Convert from 1-based to 0-based indexing
          const startLine = range.startLine - 1;
          const endLine = range.endLine - 1;
          const startPos = new vscode.Position(startLine, 0);
          const endPos = new vscode.Position(endLine, editor.document.lineAt(Math.min(endLine, editor.document.lineCount - 1)).text.length);
          return new vscode.Range(startPos, endPos);
        });
        
        editor.setDecorations(this.decorationType, decorationRanges);
      } else {
        // If no line ranges, highlight the entire file
        const lastLine = editor.document.lineCount - 1;
        const fullDocRange = new vscode.Range(
          0, 0,
          lastLine, editor.document.lineAt(lastLine).text.length
        );
        editor.setDecorations(this.decorationType, [fullDocRange]);
      }
    } else {
      // Clear decorations for files that are no longer included
      editor.setDecorations(this.decorationType, [])
    }
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
    
    // Also clear all line ranges
    this.fileLineRanges.clear();
    
    // Save to persistent storage
    this.saveIncludedFiles();
    
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
  
  /**
   * Loads the list of included files from storage
   */
  private loadIncludedFiles(): void {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.storageFilePath, 'utf-8'))
        
        // Load included files
        if (Array.isArray(data.files)) {
          this.includedFiles = new Set(data.files)
        }
        
        // Load line ranges if they exist
        if (data.lineRanges && typeof data.lineRanges === 'object') {
          this.fileLineRanges = new Map(Object.entries(data.lineRanges))
        }
      }
    } catch (error) {
      console.error('Error loading included files:', error)
    }
  }
  
  /**
   * Sets specific line ranges for a file
   * @param filePath The path to the file
   * @param ranges Array of line ranges to include
   */
  public setLineRanges(filePath: string, ranges: LineRange[]): void {
    // Ensure file is in the included list
    if (!this.includedFiles.has(filePath)) {
      this.includedFiles.add(filePath)
    }
    
    this.fileLineRanges.set(filePath, ranges)
    this.saveIncludedFiles()
    
    // Update UI elements to reflect the changes
    this.updateStatusBarForFile(filePath);
    this.updateAllEditorDecorations();
  }
  
  /**
   * Clears any line ranges for a file
   * @param filePath The file path to clear line ranges for
   */
  public clearLineRanges(filePath: string): void {
    console.log(`Clearing line ranges for file: ${filePath}`);
    // Clear the entry from the map
    this.fileLineRanges.delete(filePath);
    
    // Save changes to persistent storage
    this.saveIncludedFiles();
    
    // Update UI elements
    this.updateStatusBarForFile(filePath);
    this.updateAllEditorDecorations();
    this.treeDataProvider.refresh();
  }
  
  /**
   * Gets the line ranges for a file
   * @param filePath The path to the file
   * @returns Array of line ranges or undefined if no ranges are set
   */
  public getLineRanges(filePath: string): LineRange[] | undefined {
    return this.fileLineRanges.get(filePath)
  }

  async revealLineRange(uri: vscode.Uri, startLine: number, endLine: number): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      
      // Create a selection from start to end line
      const startPos = new vscode.Position(startLine, 0);
      const endPos = new vscode.Position(endLine, document.lineAt(endLine).text.length);
      const range = new vscode.Range(startPos, endPos);
      
      // Set selection and reveal
      editor.selection = new vscode.Selection(startPos, endPos);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      console.error('Error revealing line range:', error);
      vscode.window.showErrorMessage(`Could not reveal line range: ${error}`);
    }
  }

  removeLineRange(item: FileTreeItem): void {
    if (!item.lineRange || !item.uri) {
      return;
    }
    
    const filePath = item.uri.fsPath;
    const lineRanges = this.getLineRanges(filePath) || [];
    
    // Find and remove the specific line range
    const updatedRanges = lineRanges.filter(
      range => !(range.startLine === item.lineRange!.startLine && range.endLine === item.lineRange!.endLine)
    );
    
    if (updatedRanges.length === 0) {
      // No more ranges, remove the entry
      this.clearLineRanges(filePath);
    } else {
      // Update with remaining ranges
      this.setLineRanges(filePath, updatedRanges);
    }
    
    // Update decorations explicitly (in case the above methods didn't)
    this.updateAllEditorDecorations();
    
    // Refresh the tree view
    this.treeDataProvider.refresh();
    vscode.window.showInformationMessage(`Removed lines ${item.lineRange.startLine}-${item.lineRange.endLine} from context.`);
  }
  
  /**
   * Includes selected lines in the AI context for a specific assistant
   * @param assistant Which assistant to add the lines for: 'goose', 'cline', or 'both'
   */
  public includeSelectedLinesForAssistant(assistant: 'goose' | 'cline' | 'both'): void {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.selections.length === 0) {
      vscode.window.showWarningMessage('No active selection to include in AI context');
      return;
    }

    const filePath = activeEditor.document.uri.fsPath;
    
    // Include the file first if it's not already included
    if (!this.isFileIncluded(filePath)) {
      this.toggleFileInclusion(filePath);
    }
    
    // Get the line ranges from the selections
    const newRanges = activeEditor.selections.map(selection => {
      return {
        startLine: selection.start.line + 1, // Convert to 1-based
        endLine: selection.end.line + 1      // Convert to 1-based
      };
    });
    
    // Get existing ranges and append new ones
    const existingRanges = this.getLineRanges(filePath) || [];
    
    // Merge existing and new ranges, avoiding duplicates
    const combinedRanges = [...existingRanges];
    
    for (const newRange of newRanges) {
      // Check if this range already exists
      const isDuplicate = combinedRanges.some(
        range => range.startLine === newRange.startLine && range.endLine === newRange.endLine
      );
      
      if (!isDuplicate) {
        combinedRanges.push(newRange);
      }
    }
    
    // Store the combined line ranges for this file
    this.setLineRanges(filePath, combinedRanges);
    
    // Update UI to reflect the changes
    this.updateStatusBarForFile(filePath);
    this.updateAllEditorDecorations();
    this.treeDataProvider.refresh();
    
    const totalNewLines = newRanges.reduce((sum, range) => sum + (range.endLine - range.startLine + 1), 0);
    
    // Show different messages based on which assistant was targeted
    if (assistant === 'goose') {
      vscode.window.showInformationMessage(`Added ${totalNewLines} selected lines from ${path.basename(filePath)} to Goose AI context`);
    } else if (assistant === 'cline') {
      vscode.window.showInformationMessage(`Added ${totalNewLines} selected lines from ${path.basename(filePath)} to Cline AI context`);
    } else {
      // Both
      vscode.window.showInformationMessage(`Added ${totalNewLines} selected lines from ${path.basename(filePath)} to AI context`);
    }
  }
}
