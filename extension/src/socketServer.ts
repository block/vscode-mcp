import * as net from 'net'
import * as vscode from 'vscode'
import { CommandUnion } from './types'
import { CommandHandler } from './commandHandler'
import { RegistryManager } from './registryManager'

/**
 * Manages the socket server for MCP commands
 */
export class SocketServer {
  private server: net.Server
  private registryManager: RegistryManager

  constructor(private readonly commandHandler: CommandHandler, private readonly context: vscode.ExtensionContext) {
    this.registryManager = new RegistryManager()
    this.server = this.createServer()
    this.setupWorkspaceChangeHandler()
    this.setupCleanupOnDeactivation()
  }

  /**
   * Create and configure the socket server
   */
  private createServer(): net.Server {
    const server = net.createServer(socket => {
      console.log('MCP Companion: New connection received')

      socket.on('data', async data => {
        try {
          const command = JSON.parse(data.toString()) as CommandUnion
          await this.commandHandler.handleCommand(command, socket)
        } catch (error: unknown) {
          console.error('MCP Companion: Error handling command:', error)
          socket.write(
            JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            })
          )
        }
      })

      socket.on('error', error => {
        console.error('MCP Companion: Socket error:', error)
      })
    })

    return server
  }

  /**
   * Start the socket server
   */
  public async start(): Promise<void> {
    return new Promise<void>(resolve => {
      this.server.listen(0, '127.0.0.1', async () => {
        await this.registryManager.updateRegistry(this.server)
        resolve()
      })
    })
  }

  /**
   * Set up workspace change handler to update registry
   */
  private setupWorkspaceChangeHandler(): void {
    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await this.registryManager.updateRegistryForWorkspaceChange(this.server)
    })

    // Add to context subscriptions for cleanup
    this.context.subscriptions.push(workspaceWatcher)
  }

  /**
   * Set up cleanup on deactivation
   */
  private setupCleanupOnDeactivation(): void {
    this.context.subscriptions.push({
      dispose: async () => {
        await this.registryManager.removeFromRegistry(this.server)
        this.server.close()
      },
    })
  }
}
