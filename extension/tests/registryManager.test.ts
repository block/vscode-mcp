import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RegistryManager } from '../src/registryManager'
import * as vscode from 'vscode'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as net from 'net'

// Mock vscode
vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: undefined,
  },
}))

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

// Mock os
vi.mock('os', () => ({
  tmpdir: vi.fn(() => '/mock/tmp'),
}))

describe('RegistryManager', () => {
  let registryManager: RegistryManager
  let mockServer: net.Server
  const mockPort = 12345

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock server
    mockServer = {
      address: vi.fn(() => ({ port: mockPort })),
    } as unknown as net.Server

    registryManager = new RegistryManager()

    // Reset workspace folders
    ;(vscode.workspace as any).workspaceFolders = undefined
  })

  describe('constructor', () => {
    it('should initialize with correct registry file paths', () => {
      const manager = new RegistryManager()
      expect((manager as any).portRegistryFile).toBe(path.join('/mock/tmp', 'ag-vscode-mcp-extension-registry.json'))
      expect((manager as any).altPortRegistryFile).toBe('/tmp/ag-vscode-mcp-extension-registry.json')
    })
  })

  describe('updateRegistry', () => {
    it('should handle server with no address', async () => {
      const serverWithNoAddress = {
        address: vi.fn(() => null),
      } as unknown as net.Server

      await registryManager.updateRegistry(serverWithNoAddress)
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it('should update registry with no workspace folders', async () => {
      // Mock empty registry
      ;(fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'))

      await registryManager.updateRegistry(mockServer)

      // Should write to both registry files
      expect(fs.writeFile).toHaveBeenCalledTimes(2)

      // Verify content of writes
      const expectedRegistry = {
        [`no-workspace-${process.pid}`]: mockPort,
      }

      const calls = (fs.writeFile as jest.Mock).mock.calls
      calls.forEach(call => {
        const writtenContent = JSON.parse(call[1])
        expect(writtenContent).toEqual(expectedRegistry)
      })
    })

    it('should update registry with workspace folders', async () => {
      // Mock workspace folders
      const workspaceFolders = [{ uri: { fsPath: '/workspace1' } }, { uri: { fsPath: '/workspace2' } }]
      ;(vscode.workspace as any).workspaceFolders = workspaceFolders

      // Mock existing registry
      ;(fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          '/workspace1': 9999,
          '/old-workspace': 8888,
        })
      )

      await registryManager.updateRegistry(mockServer)

      // Should write to both registry files
      expect(fs.writeFile).toHaveBeenCalledTimes(2)

      // Verify content of writes
      const expectedRegistry = {
        '/workspace1': mockPort,
        '/workspace2': mockPort,
        '/old-workspace': 8888,
      }

      const calls = (fs.writeFile as jest.Mock).mock.calls
      calls.forEach(call => {
        const writtenContent = JSON.parse(call[1])
        expect(writtenContent).toEqual(expectedRegistry)
      })
    })

    it('should handle file read errors gracefully', async () => {
      // Mock read error
      ;(fs.readFile as jest.Mock).mockRejectedValue(new Error('Read error'))
      ;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/workspace1' } }]

      await registryManager.updateRegistry(mockServer)

      // Should still write to both registry files
      expect(fs.writeFile).toHaveBeenCalledTimes(2)

      // Verify content of writes
      const expectedRegistry = {
        '/workspace1': mockPort,
      }

      const calls = (fs.writeFile as jest.Mock).mock.calls
      calls.forEach(call => {
        const writtenContent = JSON.parse(call[1])
        expect(writtenContent).toEqual(expectedRegistry)
      })
    })
  })

  describe('updateRegistryForWorkspaceChange', () => {
    it('should update registry when workspaces change', async () => {
      // Mock workspace folders
      ;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/new-workspace' } }]

      // Mock existing registry
      ;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ '/old-workspace': 9999 }))

      await registryManager.updateRegistryForWorkspaceChange(mockServer)

      // Should write to both registry files
      expect(fs.writeFile).toHaveBeenCalledTimes(2)

      // Verify content of writes
      const expectedRegistry = {
        '/new-workspace': mockPort,
        '/old-workspace': 9999,
      }

      const calls = (fs.writeFile as jest.Mock).mock.calls
      calls.forEach(call => {
        const writtenContent = JSON.parse(call[1])
        expect(writtenContent).toEqual(expectedRegistry)
      })
    })

    it('should handle server with no address', async () => {
      const serverWithNoAddress = {
        address: vi.fn(() => null),
      } as unknown as net.Server

      await registryManager.updateRegistryForWorkspaceChange(serverWithNoAddress)
      expect(fs.writeFile).not.toHaveBeenCalled()
    })
  })

  describe('removeFromRegistry', () => {
    it('should remove server entries from registry', async () => {
      // Mock existing registry
      const existingRegistry = {
        '/workspace1': mockPort,
        '/workspace2': mockPort,
        '/other-workspace': 9999,
      }
      ;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(existingRegistry))

      await registryManager.removeFromRegistry(mockServer)

      // Should write to both registry files
      expect(fs.writeFile).toHaveBeenCalledTimes(2)

      // Verify content of writes - only entries with different ports should remain
      const expectedRegistry = {
        '/other-workspace': 9999,
      }

      const calls = (fs.writeFile as jest.Mock).mock.calls
      calls.forEach(call => {
        const writtenContent = JSON.parse(call[1])
        expect(writtenContent).toEqual(expectedRegistry)
      })
    })

    it('should handle missing registry files gracefully', async () => {
      // Mock read error
      ;(fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'))

      await registryManager.removeFromRegistry(mockServer)

      // Should not attempt to write
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it('should handle server with no address', async () => {
      const serverWithNoAddress = {
        address: vi.fn(() => null),
      } as unknown as net.Server

      // Mock existing registry
      ;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ '/workspace': mockPort }))

      await registryManager.removeFromRegistry(serverWithNoAddress)

      // Should not modify the registry
      expect(fs.writeFile).not.toHaveBeenCalled()
    })
  })
})
