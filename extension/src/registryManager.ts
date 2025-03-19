import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as vscode from 'vscode'
import * as net from 'net'

/**
 * Manages the port registry files for VS Code instance discovery
 */
export class RegistryManager {
  private readonly portRegistryFile: string
  private readonly altPortRegistryFile: string

  constructor() {
    this.portRegistryFile = path.join(os.tmpdir(), 'ag-vscode-mcp-extension-registry.json')
    this.altPortRegistryFile = '/tmp/ag-vscode-mcp-extension-registry.json'
  }

  /**
   * Update the port registry with the current workspace and port
   * @param server The socket server instance
   */
  public async updateRegistry(server: net.Server): Promise<void> {
    const address = server.address() as net.AddressInfo
    if (!address) {
      console.error('MCP Companion: Server address not available')
      return
    }

    console.log('MCP Companion: Server listening on port', address.port)
    console.log('MCP Companion: Updating port registry at', this.portRegistryFile, 'and', this.altPortRegistryFile)

    try {
      // Get the current workspace folders
      const workspaceFolders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || []

      // If no workspace is open, use a special identifier
      const workspaceKeys = workspaceFolders.length > 0 ? workspaceFolders : ['no-workspace-' + process.pid]

      // Update both registry files
      await Promise.all([
        this.updatePortRegistry(this.portRegistryFile, workspaceKeys, address.port),
        this.updatePortRegistry(this.altPortRegistryFile, workspaceKeys, address.port),
      ])

      console.log('MCP Companion: Port registry files updated successfully')
    } catch (error: unknown) {
      console.error('MCP Companion: Error updating port registry files:', error)
    }
  }

  /**
   * Update a port registry file
   * @param registryPath Path to the registry file
   * @param workspaceKeys Workspace paths to register
   * @param port Port number to register
   */
  private async updatePortRegistry(registryPath: string, workspaceKeys: string[], port: number): Promise<void> {
    let registry: Record<string, number> = {}

    // Try to read existing registry
    try {
      const content = await fs.readFile(registryPath, 'utf-8')
      registry = JSON.parse(content)
    } catch (error) {
      // If file doesn't exist or is invalid, start with empty registry
      console.log(`MCP Companion: Creating new registry at ${registryPath}`)
    }

    // Add or update entries for this instance's workspaces
    for (const workspace of workspaceKeys) {
      registry[workspace] = port
    }

    // Write updated registry back to file
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2))
  }

  /**
   * Update registry when workspaces change
   * @param server The socket server instance
   */
  public async updateRegistryForWorkspaceChange(server: net.Server): Promise<void> {
    const address = server.address() as net.AddressInfo
    if (!address) return

    const workspaceFolders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || []
    const workspaceKeys = workspaceFolders.length > 0 ? workspaceFolders : ['no-workspace-' + process.pid]

    try {
      await Promise.all([
        this.updatePortRegistry(this.portRegistryFile, workspaceKeys, address.port),
        this.updatePortRegistry(this.altPortRegistryFile, workspaceKeys, address.port),
      ])
      console.log('MCP Companion: Port registry updated after workspace change')
    } catch (error) {
      console.error('MCP Companion: Error updating port registry after workspace change:', error)
    }
  }

  /**
   * Remove entries from registry when extension is deactivated
   * @param server The socket server instance
   */
  public async removeFromRegistry(server: net.Server): Promise<void> {
    console.log('MCP Companion: Cleaning up registry entries')

    try {
      await Promise.all([
        this.removeServerFromRegistry(this.portRegistryFile, server),
        this.removeServerFromRegistry(this.altPortRegistryFile, server),
      ])
    } catch (error) {
      console.error('MCP Companion: Error cleaning up registry entries:', error)
    }
  }

  /**
   * Remove server entries from a registry file
   * @param registryPath Path to the registry file
   * @param server The socket server instance
   */
  private async removeServerFromRegistry(registryPath: string, server: net.Server): Promise<void> {
    try {
      const content = await fs.readFile(registryPath, 'utf-8')
      const registry = JSON.parse(content)

      // Get current port
      const address = server.address() as net.AddressInfo
      if (!address) return

      // Remove all entries that point to this instance's port
      for (const [workspace, port] of Object.entries(registry)) {
        if (port === address.port) {
          delete registry[workspace]
        }
      }

      // Write updated registry back to file
      await fs.writeFile(registryPath, JSON.stringify(registry, null, 2))
    } catch (error) {
      // If file doesn't exist, nothing to clean up
      console.log(`MCP Companion: No registry to clean up at ${registryPath}`)
    }
  }
}
