import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Create mock functions for RegistryManager
const mockUpdateRegistry = vi.fn()
const mockUpdateRegistryForWorkspaceChange = vi.fn()
const mockRemoveFromRegistry = vi.fn()

// Mock dependencies before importing the modules that use them
vi.mock('net', () => {
  const mockSocket = new EventEmitter()
  Object.assign(mockSocket, {
    write: vi.fn(),
  })

  const createServer = vi.fn(handler => {
    const server = new EventEmitter()
    Object.assign(server, {
      listen: vi.fn((port, host, callback) => {
        callback()
        return server
      }),
      close: vi.fn(),
      address: vi.fn(() => ({ port: 12345 })),
    })
    // Store the connection handler to call it in tests
    ;(server as any).connectionHandler = handler
    return server
  })

  return {
    createServer,
  }
})

vi.mock('vscode', () => {
  const workspaceChangeEmitter = new EventEmitter()
  return {
    workspace: {
      onDidChangeWorkspaceFolders: vi.fn(listener => {
        workspaceChangeEmitter.on('change', listener)
        return {
          dispose: vi.fn(),
        }
      }),
    },
  }
})

vi.mock('../src/commandHandler', () => ({
  CommandHandler: vi.fn().mockImplementation(() => ({
    handleCommand: vi.fn(),
  })),
}))

vi.mock('../src/registryManager', () => ({
  RegistryManager: vi.fn().mockImplementation(() => ({
    updateRegistry: mockUpdateRegistry,
    updateRegistryForWorkspaceChange: mockUpdateRegistryForWorkspaceChange,
    removeFromRegistry: mockRemoveFromRegistry,
  })),
}))

// Import after mocks are defined
import { SocketServer } from '../src/socketServer'
import { CommandHandler } from '../src/commandHandler'
import { RegistryManager } from '../src/registryManager'
import * as net from 'net'
import * as vscode from 'vscode'

describe('SocketServer', () => {
  let socketServer: SocketServer
  let mockCommandHandler: jest.Mocked<CommandHandler>
  let mockContext: vscode.ExtensionContext
  let mockServer: any
  let mockSocket: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock command handler
    mockCommandHandler = new CommandHandler() as jest.Mocked<CommandHandler>

    // Create mock context
    mockContext = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext

    // Create socket server instance
    socketServer = new SocketServer(mockCommandHandler, mockContext)

    // Get mock server instance
    mockServer = (net.createServer as jest.Mock).mock.results[0].value

    // Create mock socket
    mockSocket = new EventEmitter()
    mockSocket.write = vi.fn()
  })

  describe('constructor', () => {
    it('should create server and set up handlers', () => {
      expect(net.createServer).toHaveBeenCalled()
      expect(mockContext.subscriptions).toHaveLength(2) // Workspace watcher and cleanup handler
    })
  })

  describe('start', () => {
    it('should start server and update registry', async () => {
      await socketServer.start()

      expect(mockServer.listen).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function))
      expect(mockUpdateRegistry).toHaveBeenCalledWith(mockServer)
    })
  })

  describe('connection handling', () => {
    it('should handle incoming connections and data', async () => {
      // Simulate a connection
      mockServer.connectionHandler(mockSocket)

      // Simulate receiving command data
      const mockCommand = { type: 'ping' }
      mockSocket.emit('data', Buffer.from(JSON.stringify(mockCommand)))

      expect(mockCommandHandler.handleCommand).toHaveBeenCalledWith(mockCommand, mockSocket)
    })

    it('should handle invalid JSON data', () => {
      // Simulate a connection
      mockServer.connectionHandler(mockSocket)

      // Simulate receiving invalid JSON
      mockSocket.emit('data', Buffer.from('invalid json'))

      expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('"success":false'))
    })

    it('should handle command handler errors', async () => {
      // Simulate a connection
      mockServer.connectionHandler(mockSocket)

      // Mock command handler to throw error
      const error = new Error('Command failed')
      mockCommandHandler.handleCommand.mockRejectedValue(error)

      // Simulate receiving command data
      const mockCommand = { type: 'ping' }
      mockSocket.emit('data', Buffer.from(JSON.stringify(mockCommand)))

      // Wait for async operations
      await new Promise(process.nextTick)

      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify({
          success: false,
          error: 'Command failed',
        })
      )
    })

    it('should handle socket errors', () => {
      // Create spy for console.error
      const consoleSpy = vi.spyOn(console, 'error')

      // Simulate a connection
      mockServer.connectionHandler(mockSocket)

      // Simulate socket error
      const error = new Error('Socket error')
      mockSocket.emit('error', error)

      expect(consoleSpy).toHaveBeenCalledWith('MCP Companion: Socket error:', error)
    })
  })

  describe('workspace change handling', () => {
    it('should update registry on workspace change', async () => {
      // Get the workspace change handler
      const workspaceHandler = (vscode.workspace.onDidChangeWorkspaceFolders as jest.Mock).mock.calls[0][0]

      // Simulate workspace change
      await workspaceHandler()

      expect(mockUpdateRegistryForWorkspaceChange).toHaveBeenCalledWith(mockServer)
    })
  })

  describe('cleanup', () => {
    it('should clean up on deactivation', async () => {
      // Get cleanup handler
      const cleanupHandler = mockContext.subscriptions[1]

      // Trigger cleanup
      await cleanupHandler.dispose()

      expect(mockRemoveFromRegistry).toHaveBeenCalledWith(mockServer)
      expect(mockServer.close).toHaveBeenCalled()
    })
  })
})
