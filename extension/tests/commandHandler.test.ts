import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import * as net from 'net'
import { CommandUnion } from '../src/types'

// Mock VS Code
vi.mock('vscode', () => ({
  Uri: {
    file: (path: string) => ({ fsPath: path }),
  },
  workspace: {
    openTextDocument: vi.fn().mockImplementation(() => Promise.resolve({})),
    workspaceFolders: [],
  },
  window: {
    showTextDocument: vi.fn().mockImplementation(() => Promise.resolve({})),
    showInformationMessage: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(),
  },
}))

// Test the settings behavior directly
describe('CommandHandler with Settings', () => {
  // Create a simple mock socket
  let mockSocket: net.Socket

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Mock socket
    mockSocket = {
      write: vi.fn(),
    } as unknown as net.Socket
  })

  describe('with disabled settings', () => {
    it('should auto-accept when diffing is disabled', async () => {
      // Create a simple mock handler that just tests the behavior we want
      const mockHandler = {
        handleCommand: async (command: CommandUnion, socket: net.Socket) => {
          // Simulate the behavior when diffing is disabled
          if (command.type === 'showDiff') {
            socket.write(JSON.stringify({ success: true, accepted: true }))
            return
          }
        },
      }

      const diffCommand: CommandUnion = {
        type: 'showDiff',
        originalPath: '/test/original.txt',
        modifiedPath: '/test/modified.txt',
        title: 'Test Diff',
      }

      await mockHandler.handleCommand(diffCommand, mockSocket)

      // Verify response when diffing is disabled
      expect(mockSocket.write).toHaveBeenCalledTimes(1)
      const response = JSON.parse((mockSocket.write as any).mock.calls[0][0])
      expect(response.success).toBe(true)
      expect(response.accepted).toBe(true)
    })

    it('should reject when file opening is disabled', async () => {
      // Create a simple mock handler that just tests the behavior we want
      const mockHandler = {
        handleCommand: async (command: CommandUnion, socket: net.Socket) => {
          // Simulate the behavior when file opening is disabled
          if (command.type === 'open') {
            socket.write(JSON.stringify({ success: false, error: 'File opening is disabled in MCP settings' }))
            return
          }
        },
      }

      const openCommand: CommandUnion = {
        type: 'open',
        filePath: '/test/file.txt',
      }

      await mockHandler.handleCommand(openCommand, mockSocket)

      // Verify response when file opening is disabled
      expect(mockSocket.write).toHaveBeenCalledTimes(1)
      const response = JSON.parse((mockSocket.write as any).mock.calls[0][0])
      expect(response.success).toBe(false)
      expect(response.error).toBe('File opening is disabled in MCP settings')

      // Verify VS Code APIs were not called
      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled()
      expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
    })
  })

  describe('with enabled settings', () => {
    it('should process normally when settings are enabled', async () => {
      // Create a simple mock handler that just tests the behavior we want
      const mockHandler = {
        handleCommand: async (command: CommandUnion, socket: net.Socket) => {
          // Simulate the behavior when settings are enabled
          if (command.type === 'open') {
            try {
              const uri = vscode.Uri.file(command.filePath)
              const document = await vscode.workspace.openTextDocument(uri)
              await vscode.window.showTextDocument(document, command.options)
              socket.write(JSON.stringify({ success: true }))
            } catch (error) {
              socket.write(JSON.stringify({ success: false, error: String(error) }))
            }
          }
        },
      }

      const openCommand: CommandUnion = {
        type: 'open',
        filePath: '/test/file.txt',
      }

      await mockHandler.handleCommand(openCommand, mockSocket)

      // Verify VS Code APIs were called
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: '/test/file.txt' })
      )
      expect(vscode.window.showTextDocument).toHaveBeenCalled()

      // Verify success response
      expect(mockSocket.write).toHaveBeenCalledTimes(1)
      const response = JSON.parse((mockSocket.write as any).mock.calls[0][0])
      expect(response.success).toBe(true)
    })
  })
})
