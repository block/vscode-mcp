import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommandHandler } from '../src/commandHandler'
import { DiffManager } from '../src/diffManager'
import * as vscode from 'vscode'
import * as net from 'net'
import { CommandUnion } from '../src/types'

// Mock vscode
vi.mock('vscode', () => ({
  Uri: {
    file: (path: string) => ({ fsPath: path }),
  },
  workspace: {
    openTextDocument: vi.fn(),
    workspaceFolders: [],
  },
  window: {
    showTextDocument: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(),
  },
}))

// Mock DiffManager
vi.mock('../src/diffManager', () => ({
  DiffManager: vi.fn().mockImplementation(() => ({
    showDiff: vi.fn().mockResolvedValue(true),
    createDiffResponse: vi.fn().mockReturnValue({ success: true }),
  })),
}))

describe('CommandHandler', () => {
  let commandHandler: CommandHandler
  let mockSocket: net.Socket
  let diffManager: DiffManager

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Create mock instances
    diffManager = new DiffManager({} as vscode.ExtensionContext)
    commandHandler = new CommandHandler(diffManager)

    // Mock socket
    mockSocket = {
      write: vi.fn(),
    } as unknown as net.Socket
  })

  describe('handleCommand', () => {
    it('should handle ping command successfully', async () => {
      const pingCommand: CommandUnion = {
        type: 'ping',
      }

      await commandHandler.handleCommand(pingCommand, mockSocket)

      expect(mockSocket.write).toHaveBeenCalledWith(JSON.stringify({ success: true }))
    })

    it('should handle open command successfully', async () => {
      const openCommand: CommandUnion = {
        type: 'open',
        filePath: '/test/path.ts',
        options: { preview: true },
      }

      // Mock successful document opening
      const mockDocument = { test: 'document' }
      vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(mockDocument as unknown as vscode.TextDocument)
      vi.mocked(vscode.window.showTextDocument).mockResolvedValue(undefined as unknown as vscode.TextEditor)

      await commandHandler.handleCommand(openCommand, mockSocket)

      expect(vscode.workspace.openTextDocument).toHaveBeenCalled()
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(mockDocument, {
        preview: true,
      })
      expect(mockSocket.write).toHaveBeenCalledWith(JSON.stringify({ success: true }))
    })

    it('should handle showDiff command successfully', async () => {
      const showDiffCommand: CommandUnion = {
        type: 'showDiff',
        originalPath: '/path/original.ts',
        modifiedPath: '/path/modified.ts',
        title: 'Test Diff',
      }

      await commandHandler.handleCommand(showDiffCommand, mockSocket)

      expect(diffManager.showDiff).toHaveBeenCalledWith('/path/original.ts', '/path/modified.ts', 'Test Diff')
      expect(diffManager.createDiffResponse).toHaveBeenCalledWith(true)
      expect(mockSocket.write).toHaveBeenCalledWith(JSON.stringify({ success: true }))
    })

    it('should handle errors gracefully', async () => {
      const openCommand: CommandUnion = {
        type: 'open',
        filePath: '/test/path.ts',
        options: { preview: true },
      }

      // Mock an error
      const error = new Error('Test error')
      vi.mocked(vscode.workspace.openTextDocument).mockRejectedValue(error)

      await commandHandler.handleCommand(openCommand, mockSocket)

      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify({
          success: false,
          error: 'Test error',
        })
      )
    })

    it('should handle getCurrentWorkspace command', async () => {
      const getCurrentWorkspaceCommand: CommandUnion = {
        type: 'getCurrentWorkspace',
      }

      // Mock workspace folders
      ;(vscode.workspace.workspaceFolders as any) = [
        { uri: { fsPath: '/workspace1' } },
        { uri: { fsPath: '/workspace2' } },
      ]

      await commandHandler.handleCommand(getCurrentWorkspaceCommand, mockSocket)

      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify({
          success: true,
          workspaces: ['/workspace1', '/workspace2'],
        })
      )
    })
  })
})
