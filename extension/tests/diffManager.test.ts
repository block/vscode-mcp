import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiffManager } from '../src/diffManager'
import * as vscode from 'vscode'

// Mock vscode namespace
vi.mock('vscode', () => {
  const mockStatusBarItem = {
    dispose: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
  }

  return {
    window: {
      createStatusBarItem: vi.fn(() => ({ ...mockStatusBarItem })),
      showTextDocument: vi.fn(),
    },
    commands: {
      registerCommand: vi.fn(),
      executeCommand: vi.fn(),
    },
    workspace: {
      openTextDocument: vi.fn(),
    },
    StatusBarAlignment: {
      Right: 1,
    },
    ThemeColor: class {
      constructor(public id: string) {}
    },
    Uri: {
      file: (path: string) => ({ fsPath: path, path }),
    },
  }
})

describe('DiffManager', () => {
  let diffManager: DiffManager
  let mockContext: vscode.ExtensionContext
  let mockAcceptButton: any
  let mockRejectButton: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock context
    mockContext = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext

    // Create instance of DiffManager
    diffManager = new DiffManager(mockContext)

    // Reset mocked status bar items
    mockAcceptButton = undefined
    mockRejectButton = undefined

    // Track status bar item creation
    ;(vscode.window.createStatusBarItem as jest.Mock).mockImplementation((alignment, priority) => {
      const item = {
        dispose: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        text: '',
        command: '',
        backgroundColor: undefined,
      }
      if (priority === 100) {
        mockAcceptButton = item
      } else if (priority === 99) {
        mockRejectButton = item
      }
      return item
    })
  })

  describe('constructor', () => {
    it('should register commands on initialization', () => {
      expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2)
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith('mcp.acceptChanges', expect.any(Function))
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith('mcp.rejectChanges', expect.any(Function))
      expect(mockContext.subscriptions).toHaveLength(2)
    })
  })

  describe('showDiff', () => {
    it('should create status bar items with correct properties', async () => {
      const diffPromise = diffManager.showDiff('/path/original.ts', '/path/modified.ts', 'Test Diff')

      expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(2)

      // Check accept button
      expect(mockAcceptButton).toBeDefined()
      expect(mockAcceptButton.text).toBe('$(check) Accept Changes')
      expect(mockAcceptButton.command).toBe('mcp.acceptChanges')
      expect(mockAcceptButton.backgroundColor).toBeInstanceOf(vscode.ThemeColor)
      expect(mockAcceptButton.backgroundColor.id).toBe('statusBarItem.warningBackground')
      expect(mockAcceptButton.show).toHaveBeenCalled()

      // Check reject button
      expect(mockRejectButton).toBeDefined()
      expect(mockRejectButton.text).toBe('$(x) Reject Changes')
      expect(mockRejectButton.command).toBe('mcp.rejectChanges')
      expect(mockRejectButton.backgroundColor).toBeInstanceOf(vscode.ThemeColor)
      expect(mockRejectButton.backgroundColor.id).toBe('statusBarItem.errorBackground')
      expect(mockRejectButton.show).toHaveBeenCalled()

      // Verify diff command execution
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.any(Object), // Uri for original file
        expect.any(Object), // Uri for modified file
        'Test Diff (Review Changes)'
      )
    })

    it('should handle accept choice correctly', async () => {
      const diffPromise = diffManager.showDiff('/path/original.ts', '/path/modified.ts', 'Test Diff')

      // Simulate accepting changes by calling the registered command handler
      const acceptHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'mcp.acceptChanges'
      )[1]

      await acceptHandler()

      const result = await diffPromise
      expect(result).toBe(true)

      // Verify cleanup
      expect(mockAcceptButton.dispose).toHaveBeenCalled()
      expect(mockRejectButton.dispose).toHaveBeenCalled()
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.closeActiveEditor')
    })

    it('should handle reject choice correctly', async () => {
      const diffPromise = diffManager.showDiff('/path/original.ts', '/path/modified.ts', 'Test Diff')

      // Simulate rejecting changes by calling the registered command handler
      const rejectHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'mcp.rejectChanges'
      )[1]

      await rejectHandler()

      const result = await diffPromise
      expect(result).toBe(false)

      // Verify cleanup
      expect(mockAcceptButton.dispose).toHaveBeenCalled()
      expect(mockRejectButton.dispose).toHaveBeenCalled()
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.closeActiveEditor')
    })

    it('should reopen original file after handling choice', async () => {
      const originalPath = '/path/original.ts'
      const diffPromise = diffManager.showDiff(originalPath, '/path/modified.ts', 'Test Diff')

      // Mock document
      const mockDocument = { uri: vscode.Uri.file(originalPath) }
      ;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument)

      // Simulate accepting changes
      const acceptHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'mcp.acceptChanges'
      )[1]

      await acceptHandler()
      await diffPromise

      // Verify original file is reopened
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({ fsPath: originalPath }))
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(mockDocument)
    })
  })

  describe('createDiffResponse', () => {
    it('should create correct response for accepted changes', () => {
      const response = diffManager.createDiffResponse(true)
      expect(response).toEqual({
        success: true,
        accepted: true,
      })
    })

    it('should create correct response for rejected changes', () => {
      const response = diffManager.createDiffResponse(false)
      expect(response).toEqual({
        success: true,
        accepted: false,
      })
    })
  })
})
