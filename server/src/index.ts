import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as net from 'net'
import * as os from 'os'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { MCPConnectionHandler, DebugSessionManager, ConnectionOptions } from './connectionHandler.js'

const execAsync = promisify(exec)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// --- Interfaces ---

interface ServerConfig {
  projectsBaseDir?: string
}

interface ApplyFileChangesArgs {
  filePath: string
  newContent: string
  description?: string
  targetProjectPath: string
}

interface OpenFileArgs {
  filePath: string
  targetProjectPath: string
}

interface GetWorkspaceInfoArgs {
  targetProjectPath: string
}

interface ExecuteCommandArgs {
  command: string
  cwd?: string
  targetProjectPath: string
}

// Code Intelligence interfaces
interface GetCompletionsArgs {
  filePath: string
  position: {
    line: number
    character: number
  }
  triggerCharacter?: string
  targetProjectPath: string
}

// Define a common structure for tool definitions
interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
  handler: (args: any) => Promise<any>
}

// Define a type for tool responses
interface ToolResponse {
  content: Array<{
    type: string
    text: string
  }>
}

// --- Standalone Logging ---
async function logToFile(message: string, ...args: any[]): Promise<void> {
  const timestamp = new Date().toISOString()
  const formattedArgs = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
  const logMessage = `[${timestamp}] ${message} ${formattedArgs}`.trim() + '\n'
  const logFile = path.join(__dirname, '..', 'code-mcp-server-debug.log')

  try {
    await fs.appendFile(logFile, logMessage)
  } catch {
    // If we can't log to file, use console as last resort
    console.error(logMessage)
  }
}

// --- VSCode Server Class ---
class VSCodeServer {
  private server: Server
  private config: ServerConfig = {}
  private logFile: string
  private connections: Map<string, MCPConnectionHandler> = new Map()
  private tools: ToolDefinition[] = []

  constructor(config: ServerConfig = {}) {
    this.logFile = path.join(__dirname, '..', 'code-mcp-server-debug.log')

    // Log server startup
    this.log('MCP Server started')

    // Read projects base directory from environment variable
    if (process.env.PROJECTS_BASE_DIR) {
      config.projectsBaseDir = process.env.PROJECTS_BASE_DIR
    }

    this.config = config

    this.server = new Server(
      {
        name: 'code-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    // Register tools
    this.registerTools()

    // Set up server request handlers
    this.setupRequestHandlers()
  }

  // Register all available tools
  private registerTools(): void {
    // Tool to apply changes to a file with a diff view
    this.tools.push({
      name: 'apply_file_changes',
      description: 'Apply changes to a file with a diff view for user approval',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to modify',
          },
          newContent: {
            type: 'string',
            description: 'New content to apply to the file',
          },
          description: {
            type: 'string',
            description: 'Description of the changes being made',
          },
          targetProjectPath: {
            type: 'string',
            description: 'Path to the target project directory',
          },
        },
        required: ['filePath', 'newContent', 'targetProjectPath'],
      },
      handler: this.applyFileChanges.bind(this),
    })

    // Tool to open a file in VSCode
    this.tools.push({
      name: 'open_file',
      description: 'Open a file in VS Code',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to open',
          },
          targetProjectPath: {
            type: 'string',
            description: 'Path to the target project directory',
          },
        },
        required: ['filePath', 'targetProjectPath'],
      },
      handler: this.openFile.bind(this),
    })

    // Tool to get current workspace info
    this.tools.push({
      name: 'get_workspace_info',
      description: 'Get information about the current workspace',
      inputSchema: {
        type: 'object',
        properties: {
          targetProjectPath: {
            type: 'string',
            description: 'Path to the target project directory',
          },
        },
        required: ['targetProjectPath'],
      },
      handler: this.getWorkspaceInfo.bind(this),
    })

    // Tool to execute a command in VSCode terminal
    this.tools.push({
      name: 'execute_command',
      description: 'Execute a command in VS Code terminal',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command',
          },
          targetProjectPath: {
            type: 'string',
            description: 'Path to the target project directory',
          },
        },
        required: ['command', 'targetProjectPath'],
      },
      handler: this.executeCommand.bind(this),
    })

    // Tool to get code completions
    this.tools.push({
      name: 'get_completions',
      description: 'Get code completion suggestions at a specific position in a file',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file',
          },
          position: {
            type: 'object',
            properties: {
              line: { 
                type: 'number', 
                description: 'Line number (0-based)' 
              },
              character: { 
                type: 'number', 
                description: 'Character position (0-based)' 
              },
            },
            required: ['line', 'character'],
          },
          triggerCharacter: {
            type: 'string',
            description: 'Optional character that triggered completion (e.g., "." for method completion)',
          },
          targetProjectPath: {
            type: 'string',
            description: 'Path to the target project directory',
          },
        },
        required: ['filePath', 'position', 'targetProjectPath'],
      },
      handler: this.getCompletions.bind(this),
    })

    this.log(`Registered ${this.tools.length} tools`)
  }

  // Set up server request handlers
  private setupRequestHandlers(): void {
    // Handler for listing available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      await this.log('Handling ListTools request')

      const result = {
        tools: this.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      }

      await this.log(`Returning ${result.tools.length} tools`)
      return result
    })

    // Handler for calling a tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, parameters } = request
      await this.log(`Handling CallTool request for: ${name}`)

      const tool = this.tools.find(t => t.name === name)
      if (!tool) {
        await this.log(`Tool not found: ${name}`)
        throw new Error(`Tool not found: ${name}`)
      }

      try {
        const result = await tool.handler(parameters)
        await this.log(`Tool ${name} executed successfully`)
        return result
      } catch (error) {
        await this.log(`Error executing tool ${name}:`, error)
        throw error
      }
    })
  }

  private async log(message: string, ...args: any[]): Promise<void> {
    const timestamp = new Date().toISOString()
    const formattedArgs = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
    const logMessage = `[${timestamp}] ${message} ${formattedArgs}`.trim() + '\n'

    try {
      await fs.appendFile(this.logFile, logMessage)
    } catch (error) {
      console.error('Failed to write to log file:', error)
    }
  }

  private async createTempFile(content: string): Promise<string> {
    const tmpdir = process.env.TMPDIR || process.env.TMP || '/tmp'
    const tempFile = path.join(tmpdir, `ag-vscode-mcp-${Date.now()}.tmp`)
    await fs.writeFile(tempFile, content, 'utf-8')
    return tempFile
  }

  // Helper to safely clean up temporary files
  private async cleanupTempFile(tempFile: string): Promise<void> {
    try {
      await fs.unlink(tempFile)
    } catch (error) {
      await this.log(`Failed to clean up temp file ${tempFile}:`, error)
    }
  }

  private async findExtensionRegistry(): Promise<Record<string, number> | null> {
    try {
      const registryLocations = [
        path.join(os.tmpdir(), 'ag-vscode-mcp-extension-registry.json'),
        '/tmp/ag-vscode-mcp-extension-registry.json',
      ]

      let registry: Record<string, number> | null = null

      // Try to read the registry from any available location
      for (const registryPath of registryLocations) {
        try {
          const content = await fs.readFile(registryPath, 'utf-8')
          registry = JSON.parse(content)
          await this.log('Found extension registry at:', registryPath)
          break
        } catch (error) {
          await this.log('Could not read registry from:', registryPath)
        }
      }

      if (!registry) {
        await this.log('Could not find extension registry in any location')
      }

      return registry
    } catch (error) {
      await this.log('Error reading extension registry:', error)
      return null
    }
  }

  private async findExtensionPort(targetProjectPath: string): Promise<number | null> {
    try {
      const registry = await this.findExtensionRegistry()

      if (!registry) {
        return null
      }

      // If we have a target project path, try to find a matching extension instance
      if (targetProjectPath) {
        const absolutePath = path.isAbsolute(targetProjectPath) ? targetProjectPath : path.resolve(targetProjectPath)

        // First, look for an exact match
        if (registry[absolutePath]) {
          const port = registry[absolutePath]
          await this.log(`Found exact workspace match with port ${port}`)
          return port
        }

        // Next, look for a parent/child relationship
        for (const [workspace, port] of Object.entries(registry)) {
          if (absolutePath.startsWith(workspace + path.sep) || workspace.startsWith(absolutePath + path.sep)) {
            await this.log(`Found related workspace match with port ${port}`)
            return port
          }
        }

        await this.log('No matching workspace found in registry')
        
        // If no match found but we have entries, return the first port
        if (Object.keys(registry).length > 0) {
          const firstPort = Object.values(registry)[0]
          await this.log(`Using first available port: ${firstPort}`)
          return firstPort
        }
      }

      // If no target workspace or no match found, return null
      return null
    } catch (error) {
      await this.log('Error finding extension port:', error)
      return null
    }
  }

  // Helper method to get or create a connection handler for a project path
  private async getConnection(projectPath: string): Promise<MCPConnectionHandler> {
    const absolutePath = path.isAbsolute(projectPath) ? projectPath : path.resolve(projectPath);

    if (!this.connections.has(absolutePath)) {
      const port = await this.findExtensionPort(absolutePath);
      if (!port) {
        throw new Error(`Could not find extension port for project path: ${absolutePath}`);
      }

      const options: ConnectionOptions = {
        host: 'localhost',
        port: port,
        reconnectAttempts: 5,
        timeout: 10000,
      };

      const connection = new MCPConnectionHandler(options);
      this.connections.set(absolutePath, connection);

      // Set up connection event handlers
      connection.on('error', async (error) => {
        await this.log(`Connection error for ${absolutePath}:`, error);
      });

      connection.on('reconnected', async (attempt) => {
        await this.log(`Connection for ${absolutePath} reconnected after ${attempt} attempts`);
      });

      connection.on('connectionClosedError', async (error) => {
        await this.log(`Connection closed error for ${absolutePath}:`, error);
        // Attempt to handle the connection closed error
        const success = await connection.handleConnectionClosedError();
        if (!success) {
          await this.log(`Failed to recover connection for ${absolutePath}`);
        }
      });
    }

    const connection = this.connections.get(absolutePath)!;
    await connection.connect(); // Ensure the connection is established
    return connection;
  }

  private async showDiff(originalPath: string, modifiedPath: string, title: string, targetProjectPath: string): Promise<boolean> {
    await this.log('Attempting to show diff:', {
      originalPath,
      modifiedPath,
      title,
      targetProjectPath,
    });

    // Check if the original file exists
    try {
      await fs.access(originalPath);
    } catch (error) {
      await this.log('Error: Original file does not exist:', originalPath);
      throw new Error(`Cannot perform diff because the target file does not exist: ${originalPath}`);
    }

    // Try to show diff in VS Code via extension
    const connection = await this.getConnection(targetProjectPath);

    try {
      const command = {
        type: 'showDiff',
        originalPath,
        modifiedPath,
        title,
      };
      
      await this.log('Sending command to extension:', command);

      const response = await connection.sendRequest<{
        success: boolean
        accepted?: boolean
        error?: string
      }>('showDiff', command);

      if (response.error) {
        throw new Error(response.error);
      }

      // If changes were accepted, apply them
      if (response.accepted) {
        const modifiedContent = await fs.readFile(modifiedPath, 'utf-8');
        await fs.writeFile(originalPath, modifiedContent);
        await this.log('Changes accepted and applied to file:', originalPath);
      } else {
        await this.log('Changes were rejected for file:', originalPath);
      }

      return response.accepted || false;
    } catch (error) {
      await this.log('Error showing diff in VS Code:', error);
      throw error;
    }
  }

  // File change tool
  private async applyFileChanges(args: ApplyFileChangesArgs): Promise<ToolResponse> {
    const { filePath, newContent, description, targetProjectPath } = args;
    let tempFile: string | null = null;

    try {
      // Validate the file exists
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

      // Check if the file exists
      try {
        await fs.access(absolutePath);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Cannot perform diff because the file does not exist: ${filePath}`,
            },
          ],
        };
      }

      // Create temp file for the modified version
      tempFile = await this.createTempFile(newContent);

      // Show diff and get user's decision
      const accepted = await this.showDiff(
        absolutePath,
        tempFile,
        description || 'Previewing Changes',
        targetProjectPath
      );

      return {
        content: [
          {
            type: 'text',
            text: accepted
              ? 'Changes were accepted and applied to the file.'
              : 'Changes were rejected. You should stop executing at this point and ask clarifying questions to understand why this change was rejected.',
          },
        ],
      };
    } catch (error) {
      await this.log('Error applying file changes:', error);
      
      return {
        content: [
          {
            type: 'text',
            text: `Error applying file changes: ${error}`,
          },
        ],
      };
    } finally {
      // Always clean up temp file if it was created
      if (tempFile) {
        await this.cleanupTempFile(tempFile);
      }
    }
  }

  // Method to open a file in VSCode
  private async openFile(args: OpenFileArgs): Promise<ToolResponse> {
    const { filePath, targetProjectPath } = args;

    try {
      // Validate the file exists
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

      // Check if the file exists
      try {
        await fs.access(absolutePath);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Cannot open file because it does not exist: ${filePath}`,
            },
          ],
        };
      }

      // Try to open the file in VS Code via extension
      const connection = await this.getConnection(targetProjectPath);

      const command = {
        type: 'open',
        filePath: absolutePath,
      };
      
      await this.log('Sending command to extension:', command);

      const response = await connection.sendRequest<{
        success: boolean
        error?: string
      }>('open', command);

      if (response.error) {
        throw new Error(response.error);
      }

      return {
        content: [
          {
            type: 'text',
            text: `File opened successfully: ${filePath}`,
          },
        ],
      };
    } catch (error) {
      await this.log('Error opening file in VS Code:', error);
      
      return {
        content: [
          {
            type: 'text',
            text: `Error opening file: ${error}`,
          },
        ],
      };
    }
  }

  // Method to get workspace information
  private async getWorkspaceInfo(args: GetWorkspaceInfoArgs): Promise<ToolResponse> {
    const { targetProjectPath } = args;

    try {
      // Get workspace info from VS Code via extension
      const connection = await this.getConnection(targetProjectPath);

      const command = {
        type: 'getCurrentWorkspace',
      };
      
      await this.log('Sending command to extension:', command);

      const response = await connection.sendRequest<{
        success: boolean
        workspaces?: string[]
        error?: string
      }>('getCurrentWorkspace', command);

      if (response.error) {
        throw new Error(response.error);
      }

      const workspaces = response.workspaces || [];

      return {
        content: [
          {
            type: 'text',
            text: `Workspace info: ${JSON.stringify({ workspaces })}`,
          },
        ],
      };
    } catch (error) {
      await this.log('Error getting workspace info:', error);
      
      return {
        content: [
          {
            type: 'text',
            text: `Error getting workspace info: ${error}`,
          },
        ],
      };
    }
  }

  // Method to execute a command in the terminal
  private async executeCommand(args: ExecuteCommandArgs): Promise<ToolResponse> {
    const { command, cwd, targetProjectPath } = args;

    try {
      // Execute command in VS Code via extension
      const connection = await this.getConnection(targetProjectPath);

      const commandObj = {
        type: 'executeShellCommand',
        command,
        cwd: cwd || targetProjectPath,
      };
      
      await this.log('Sending command to extension:', commandObj);

      const response = await connection.sendRequest<{
        success: boolean
        output?: string
        error?: string
      }>('executeShellCommand', commandObj);

      if (response.error) {
        throw new Error(response.error);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Command executed successfully. Output:\n${response.output || 'No output'}`,
          },
        ],
      };
    } catch (error) {
      await this.log('Error executing command:', error);
      
      return {
        content: [
          {
            type: 'text',
            text: `Error executing command: ${error}`,
          },
        ],
      };
    }
  }

  // Method to get code completions
  private async getCompletions(args: GetCompletionsArgs): Promise<ToolResponse> {
    const { filePath, position, triggerCharacter, targetProjectPath } = args;

    try {
      // Validate the file exists
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

      // Check if the file exists
      try {
        await fs.access(absolutePath);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Cannot get completions because the file does not exist: ${filePath}`,
            },
          ],
        };
      }

      // Get connection to VSCode extension
      const connection = await this.getConnection(targetProjectPath);
      
      // Send command to get completions
      const command = {
        type: 'getCompletions',
        filePath: absolutePath,
        position,
        triggerCharacter,
      };
      
      await this.log('Sending command to extension:', command);
      
      const response = await connection.sendRequest<{
        success: boolean;
        completions?: Array<{
          label: string;
          insertText?: string;
          detail?: string;
          documentation?: string;
          kind?: string;
        }>;
        error?: string;
      }>('getCompletions', command);
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      // Format the completions for response
      const completions = response.completions || [];
      
      if (completions.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No completions found at position ${position.line}:${position.character}`,
            },
          ],
        };
      }

      // Create a more readable response
      const formattedCompletions = completions.map(completion => 
        `${completion.label}${completion.detail ? ` - ${completion.detail}` : ''}`
      ).join('\n');
      
      return {
        content: [
          {
            type: 'text',
            text: `Completions at ${position.line}:${position.character}:\n\n${formattedCompletions}`,
          },
        ],
      };
    } catch (error) {
      await this.log('Error getting completions:', error);
      
      return {
        content: [
          {
            type: 'text',
            text: `Error getting completions: ${error}`,
          },
        ],
      };
    }
  }

  public async start(): Promise<void> {
    await this.log('Starting VS Code MCP Server...')
    const transport = new StdioServerTransport()
    await this.log('MCP Server starting with stdio transport')

    await this.server.connect(transport)
    await this.log('VS Code MCP Server started successfully')
  }
}

// Export the startServer function for CLI usage
export function startServer(): void {
  const server = new VSCodeServer()
  server.start().catch(async (error) => {
    await logToFile('Failed to start server:', error)
    process.exit(1)
  })
}

// Auto-start the server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
}
