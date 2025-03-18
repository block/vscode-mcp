import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as net from 'net'
import * as os from 'os'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const execAsync = promisify(exec)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface VSCodeProject {
  path: string
  name: string
  type: 'workspace' | 'folder'
}

interface ServerConfig {
  projectsBaseDir?: string
}

interface GetActiveProjectArgs {}

interface ReadFileArgs {
  filePath: string
}

interface WriteFileArgs {
  filePath: string
  content: string
  createIfMissing?: boolean
}

interface ListProjectFilesArgs {
  projectPath: string
  fileType?: string
}

interface AnalyzeFileArgs {
  filePath: string
}

interface SetProjectPathArgs {
  projectPath: string
}

interface ApplyFileChangesArgs {
  filePath: string
  newContent: string
  description?: string
  targetProjectPath: string
}

// Add standalone logging function for use outside the class
async function logToFile(message: string, ...args: any[]): Promise<void> {
  const timestamp = new Date().toISOString()
  const formattedArgs = args
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join(' ')
  const logMessage = `[${timestamp}] ${message} ${formattedArgs}`.trim() + '\n'
  const logFile = path.join(__dirname, '..', 'code-mcp-server-debug.log')

  try {
    await fs.appendFile(logFile, logMessage)
  } catch {
    // If we can't log to file, use console as last resort
    console.error(logMessage)
  }
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

class VSCodeServer {
  private server: Server
  private fileWatchers: Map<string, any> = new Map()
  private projectFiles: Map<string, string[]> = new Map()
  private config: ServerConfig = {}
  private logFile: string

  constructor(config: ServerConfig = {}) {
    this.logFile = path.join(__dirname, '..', 'code-mcp-server-debug.log')

    // Log server startup
    this.log('MCP Server started')

    // Read projects base directory from environment variable
    if (process.env.PROJECTS_BASE_DIR) {
      config.projectsBaseDir = process.env.PROJECTS_BASE_DIR
    }

    // Allow config to override environment variable
    this.config = { ...this.config, ...config }

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

    // Initialize handlers first so we can handle requests even without an active project
    this.initializeHandlers()
  }

  private async log(message: string, ...args: any[]): Promise<void> {
    const timestamp = new Date().toISOString()
    const formattedArgs = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ')
    const logMessage =
      `[${timestamp}] ${message} ${formattedArgs}`.trim() + '\n'

    try {
      await fs.appendFile(this.logFile, logMessage)
    } catch (error) {
      console.error('Failed to write to log file:', error)
    }
  }

  private async initializeHandlers() {
    // Log requests before handling
    const logRequest = async (method: string, params: any) => {
      await this.log('Incoming request:', method, params)
    }

    // Define all tools in a structured way
    const tools: ToolDefinition[] = [
      {
        name: 'create_diff',
        description:
          'Use this instead of writing files directly. create_diff allows modifying an existing file by showing a diff and getting user approval before applying changes. Only use this tool on existing files. If a new file needs to be created, do not use this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the existing file to modify',
            },
            newContent: {
              type: 'string',
              description: 'Proposed new content for the file',
            },
            description: {
              type: 'string',
              description: 'Description of the changes being made',
            },
            targetProjectPath: {
              type: 'string',
              description: 'Path to the project folder we are working in',
            },
          },
          required: ['filePath', 'newContent', 'targetProjectPath'],
        },
        handler: async (
          args: ApplyFileChangesArgs & { targetProjectPath: string }
        ): Promise<ToolResponse> => {
          if (
            !args?.filePath ||
            !args?.newContent ||
            !args?.targetProjectPath
          ) {
            throw new Error(
              'Invalid arguments: filePath, newContent, and targetProjectPath are required'
            )
          }
          return await this.applyFileChanges(args)
        },
      },
      {
        name: 'open_file',
        description:
          'Used to open a file in the VS Code editor. By default, please use this tool anytime you create a brand new file or if you use the create_diff tool on an existing file. We want to see changed and newly created files in the editor.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the file to open',
            },
            targetProjectPath: {
              type: 'string',
              description: 'Path to the project folder we are working in',
            },
            viewColumn: {
              type: 'number',
              description:
                'The view column to open the file in (1, 2, 3, etc.)',
            },
            preserveFocus: {
              type: 'boolean',
              description: 'Whether to preserve focus on the current editor',
            },
            preview: {
              type: 'boolean',
              description: 'Whether to open the file in preview mode',
            },
          },
          required: ['filePath', 'targetProjectPath'],
        },
        handler: async (args: {
          filePath: string
          targetProjectPath: string
          viewColumn?: number
          preserveFocus?: boolean
          preview?: boolean
        }): Promise<ToolResponse> => {
          if (!args?.filePath || !args?.targetProjectPath) {
            throw new Error(
              'Invalid arguments: filePath and targetProjectPath are required'
            )
          }
          return await this.openFile(args)
        },
      },
      {
        name: 'open_project',
        description:
          'Call this tool as soon as a new session begins with the AI Agent to ensure we are set up and ready to go. open_project opens a project folder in VS Code. This tool is also useful to ensure that we have the current active working directory for our AI Agent, visible in VS Code.',
        inputSchema: {
          type: 'object',
          properties: {
            projectPath: {
              type: 'string',
              description: 'Path to the project folder to open in VS Code',
            },
            newWindow: {
              type: 'boolean',
              description: 'Whether to open the project in a new window',
              default: true,
            },
          },
          required: ['projectPath'],
        },
        handler: async (args: {
          projectPath: string
          newWindow?: boolean
        }): Promise<ToolResponse> => {
          if (!args?.projectPath) {
            throw new Error('Invalid arguments: projectPath is required')
          }
          return await this.openProject(args)
        },
      },
      {
        name: 'check_extension_status',
        description:
          'Check if the VS Code MCP Extension is installed and responding',
        inputSchema: {
          type: 'object',
          properties: {
            targetProjectPath: {
              type: 'string',
              description: 'Path to the project folder we are working in',
            },
          },
          required: ['targetProjectPath'],
        },
        handler: async (args: {
          targetProjectPath: string
        }): Promise<ToolResponse> => {
          if (!args?.targetProjectPath) {
            throw new Error('Invalid arguments: targetProjectPath is required')
          }

          const extension = await this.connectToExtension(
            args.targetProjectPath
          )
          if (!extension) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'VS Code MCP Extension is not installed or not running',
                },
              ],
            }
          }

          try {
            extension.write(JSON.stringify({ type: 'ping' }))
            const response = await new Promise<{
              success?: boolean
              error?: string
            }>((resolve) => {
              extension.once('data', (data) =>
                resolve(JSON.parse(data.toString()))
              )
            })
            extension.end()

            return {
              content: [
                {
                  type: 'text',
                  text: response.success
                    ? 'VS Code MCP Extension is installed and responding'
                    : `VS Code MCP Extension error: ${
                        response.error || 'Unknown error'
                      }`,
                },
              ],
            }
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to communicate with VS Code MCP Extension: ${error}`,
                },
              ],
            }
          }
        },
      },
      {
        name: 'get_extension_port',
        description:
          'Get the port number that the VS Code MCP Extension is running on',
        inputSchema: {
          type: 'object',
          properties: {
            targetProjectPath: {
              type: 'string',
              description: 'Path to the project folder we are working in',
            },
          },
          required: ['targetProjectPath'],
        },
        handler: async (args: {
          targetProjectPath: string
        }): Promise<ToolResponse> => {
          if (!args?.targetProjectPath) {
            throw new Error('Invalid arguments: targetProjectPath is required')
          }

          try {
            const port = await this.findExtensionPort(args.targetProjectPath)

            if (!port) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Could not find extension port for the specified project path',
                  },
                ],
              }
            }

            // Verify the port is accessible
            const socket = new net.Socket()
            await new Promise<void>((resolve, reject) => {
              socket.connect(port, '127.0.0.1', async () => {
                await this.log(
                  'Successfully connected to extension on port:',
                  port
                )
                resolve()
              })
              socket.on('error', async (error) => {
                await this.log('Error connecting to extension:', error)
                reject(error)
              })
            })

            socket.end()

            return {
              content: [
                {
                  type: 'text',
                  text: `Extension port: ${port} found matching the Project Path: ${args.targetProjectPath}`,
                },
              ],
            }
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Could not connect to extension: ${error}`,
                },
              ],
            }
          }
        },
      },
      {
        name: 'list_available_projects',
        description:
          'Lists all available projects from the port registry file. Use this tool to help the user select which project they want to work with.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
        handler: async (): Promise<ToolResponse> => {
          return await this.listAvailableProjects()
        },
      },
    ]

    // Set up tool handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      await logRequest('list_tools', request.params)
      return {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      }
    })

    // Create a map of tool handlers for quick lookup
    const toolHandlers = new Map(tools.map((tool) => [tool.name, tool.handler]))

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params
      await this.log('Handling tool call:', name, rawArgs)

      try {
        // Check if targetProjectPath is missing for tools that require it
        const toolRequiresProjectPath = tools.some(
          (tool) =>
            tool.name === name &&
            tool.inputSchema.required.includes('targetProjectPath')
        )

        if (
          toolRequiresProjectPath &&
          (!rawArgs ||
            !rawArgs.targetProjectPath ||
            (typeof rawArgs.targetProjectPath === 'string' &&
              (rawArgs.targetProjectPath.trim() === '' ||
                rawArgs.targetProjectPath === '.' ||
                rawArgs.targetProjectPath === '/' ||
                rawArgs.targetProjectPath.length < 3)))
        ) {
          await this.log('Missing or invalid targetProjectPath for tool:', name)
          return {
            content: [
              {
                type: 'text',
                text: 'I need a valid project directory path. Please provide the full targetProjectPath (the complete path to your project directory). The path you provided is missing, empty, or appears to be invalid.',
              },
            ],
          }
        }

        // Get the handler for the requested tool
        const handler = toolHandlers.get(name)

        if (!handler) {
          throw new Error(`Unknown tool: ${name}`)
        }

        // Execute the handler with the provided arguments
        const response = await handler(rawArgs)
        await this.log('Tool call response:', name, response)
        return response
      } catch (error) {
        await this.log('Tool call error:', name, error)
        throw error
      }
    })
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

  private async findExtensionRegistry(): Promise<Record<
    string,
    number
  > | null> {
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

  private async findExtensionPort(
    targetProjectPath: string
  ): Promise<number | null> {
    try {
      const registry = await this.findExtensionRegistry()

      if (!registry) {
        return null
      }

      // If we have a target project path, try to find a matching extension instance
      if (targetProjectPath) {
        const absolutePath = path.isAbsolute(targetProjectPath)
          ? targetProjectPath
          : path.resolve(targetProjectPath)

        // First, look for an exact match
        if (registry[absolutePath]) {
          const port = registry[absolutePath]
          await this.log(`Found exact workspace match with port ${port}`)
          return port
        }

        // Next, look for a parent/child relationship
        for (const [workspace, port] of Object.entries(registry)) {
          if (
            absolutePath.startsWith(workspace + path.sep) ||
            workspace.startsWith(absolutePath + path.sep)
          ) {
            await this.log(`Found related workspace match with port ${port}`)
            return port
          }
        }

        await this.log('No matching workspace found in registry')
      }

      // If no target workspace or no match found, return null
      return null
    } catch (error) {
      await this.log('Error finding extension port:', error)
      return null
    }
  }

  private async connectToExtension(
    targetProjectPath?: string
  ): Promise<net.Socket | null> {
    try {
      if (targetProjectPath) {
        const port = await this.findExtensionPort(targetProjectPath)
        if (port) {
          return this.connectToPort(port)
        }
      }

      throw new Error(
        'No extension instances found in registry for the specified project path'
      )
    } catch (error) {
      await this.log('Failed to connect to VS Code extension:', error)
      return null
    }
  }

  // Helper method to connect to a specific port
  private async connectToPort(port: number): Promise<net.Socket> {
    const socket = new net.Socket()

    await new Promise<void>((resolve, reject) => {
      socket.connect(port, '127.0.0.1', () => {
        resolve()
      })

      socket.on('error', (err) => {
        reject(err)
      })
    })

    return socket
  }

  private async showDiff(
    originalPath: string,
    modifiedPath: string,
    title: string,
    targetProjectPath: string
  ) {
    await this.log('Attempting to show diff:', {
      originalPath,
      modifiedPath,
      title,
      targetProjectPath,
    })

    // Check if the original file exists
    try {
      await fs.access(originalPath)
    } catch (error) {
      await this.log('Error: Original file does not exist:', originalPath)
      throw new Error(
        `Cannot perform diff because the target file does not exist: ${originalPath}`
      )
    }

    // Try to show diff in VS Code via extension
    const extension = await this.connectToExtension(targetProjectPath)
    if (extension) {
      try {
        const command = JSON.stringify({
          type: 'showDiff',
          originalPath,
          modifiedPath,
          title,
        })
        await this.log('Sending command to extension:', command)

        extension.write(command)

        // Wait for response
        const response = await new Promise<{
          success: boolean
          accepted?: boolean
          error?: string
        }>((resolve) => {
          extension.once('data', async (data) => {
            await this.log('Received response from extension:', data.toString())
            resolve(JSON.parse(data.toString()))
          })
        })

        extension.end()

        if (response.error) {
          throw new Error(response.error)
        }

        // If changes were accepted, apply them
        if (response.accepted) {
          const modifiedContent = await fs.readFile(modifiedPath, 'utf-8')
          await fs.writeFile(originalPath, modifiedContent)
          await this.log('Changes accepted and applied to file:', originalPath)
        } else {
          await this.log('Changes were rejected for file:', originalPath)
        }

        return response.accepted
      } catch (error) {
        await this.log('Error showing diff in VS Code:', error)
        throw error
      }
    }

    // Always generate text diff as fallback
    try {
      const { stdout } = await execAsync(
        `diff -u "${originalPath}" "${modifiedPath}"`
      )
      return stdout
    } catch (error) {
      // If diff fails, create a basic text comparison
      try {
        const originalContent = await fs.readFile(originalPath, 'utf-8')
        const modifiedContent = await fs.readFile(modifiedPath, 'utf-8')
        return `--- ${originalPath}\n+++ ${modifiedPath}\n\nOriginal:\n${originalContent}\n\nModified:\n${modifiedContent}`
      } catch (readError) {
        // If reading the original file fails, it likely doesn't exist
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          await this.log(
            'Error: Cannot read original file, it does not exist:',
            originalPath
          )
          throw new Error(
            `Cannot perform diff because the target file does not exist: ${originalPath}`
          )
        }
        // For other errors, rethrow
        throw readError
      }
    }
  }

  private async applyFileChanges(
    args: ApplyFileChangesArgs & { targetProjectPath: string }
  ) {
    const { filePath, newContent, description, targetProjectPath } = args
    let tempFile: string | null = null

    try {
      // Validate the file exists
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(filePath)

      // Check if the file exists
      try {
        await fs.access(absolutePath)
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Cannot perform diff because the target file does not exist: ${filePath}`,
            },
          ],
        }
      }

      // Create temp file for the modified version
      tempFile = await this.createTempFile(newContent)

      // Connect to VS Code extension
      const extension = await this.connectToExtension(targetProjectPath)
      if (!extension) {
        throw new Error(
          'Could not connect to VS Code extension for the specified project path'
        )
      }

      // Show diff and get user's decision
      const accepted = await this.showDiff(
        absolutePath,
        tempFile,
        description || 'Previewing Changes',
        targetProjectPath
      )

      return {
        content: [
          {
            type: 'text',
            text: accepted
              ? 'Changes were accepted and applied to the file.'
              : 'Changes were rejected. You should stop executing at this point and ask clarifying questions to understand why this change was rejected.',
          },
        ],
      }
    } catch (error) {
      await this.log('Error applying file changes:', error)
      await this.log('Error details:', {
        filePath,
        newContent,
        description,
        targetProjectPath,
      })

      return {
        content: [
          {
            type: 'text',
            text: `Error applying file changes: ${error}`,
          },
        ],
      }
    } finally {
      // Always clean up temp file if it was created
      if (tempFile) {
        await this.cleanupTempFile(tempFile)
      }
    }
  }

  private async openFile(args: {
    filePath: string
    targetProjectPath: string
    viewColumn?: number
    preserveFocus?: boolean
    preview?: boolean
  }) {
    // Set default options with preview: false
    const defaultOptions = { preview: false }
    const { filePath, targetProjectPath, ...userOptions } = args

    // Merge defaults with user options (user options take precedence)
    const options = { ...defaultOptions, ...userOptions }

    await this.log('Attempting to open file:', filePath, options)

    // Ensure the file path is absolute
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(filePath)

    // Check if file exists
    try {
      await fs.access(absolutePath)
    } catch (error) {
      await this.log('File does not exist:', absolutePath)
      return {
        content: [
          {
            type: 'text',
            text: `Error: File does not exist: ${absolutePath}`,
          },
        ],
      }
    }

    // Try to open file in VS Code via extension using the targetProjectPath
    const extension = await this.connectToExtension(targetProjectPath)
    if (!extension) {
      await this.log('Could not connect to VS Code extension')
      return {
        content: [
          {
            type: 'text',
            text: "Could not connect to VS Code extension. Make sure it's installed and running.",
          },
        ],
      }
    }

    try {
      const command = JSON.stringify({
        type: 'open',
        filePath: absolutePath,
        options,
      })

      await this.log('Sending open command to extension:', command)

      extension.write(command)

      // Wait for response
      const response = await new Promise<{
        success: boolean
        error?: string
      }>((resolve) => {
        extension.once('data', async (data) => {
          await this.log('Received response from extension:', data.toString())
          resolve(JSON.parse(data.toString()))
        })
      })

      extension.end()

      if (response.error) {
        throw new Error(response.error)
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully opened file: ${filePath}`,
          },
        ],
      }
    } catch (error) {
      await this.log('Error opening file in VS Code:', error)
      return {
        content: [
          {
            type: 'text',
            text: `Error opening file: ${error}`,
          },
        ],
      }
    }
  }

  private async openProject(args: {
    projectPath: string
    newWindow?: boolean
  }): Promise<any> {
    const { projectPath, newWindow = true } = args
    await this.log('Attempting to open project:', projectPath, { newWindow })

    // Ensure the project path is absolute
    const absolutePath = path.isAbsolute(projectPath)
      ? projectPath
      : path.resolve(projectPath)

    try {
      // First check if the directory exists
      try {
        await fs.access(absolutePath)
      } catch (error) {
        await this.log('Project directory does not exist:', absolutePath)
        return {
          content: [
            {
              type: 'text',
              text: `Error: Project directory does not exist: ${absolutePath}`,
            },
          ],
        }
      }

      // Check if the project path is in the registry
      const registry = await this.findExtensionRegistry()
      if (!registry) {
        return {
          content: [
            {
              type: 'text',
              text: 'VS Code does not appear to be running. Please start VS Code and open your project folder, then try again.',
            },
          ],
        }
      }

      // Check if the project path is directly in the registry
      // if (registry[absolutePath]) {
      //   const port = registry[absolutePath];
      //   await this.log(`Found exact project match with port ${port}`);

      //   // Connect to the existing VS Code instance
      //   const extension = await this.connectToPort(port);

      //   // Focus the window
      //   const focusCommand = JSON.stringify({
      //     type: "focusWindow",
      //   });

      //   extension.write(focusCommand);

      //   const focusResponse = await new Promise<{
      //     success: boolean;
      //     error?: string;
      //   }>((resolve) => {
      //     extension.once("data", async (data) => {
      //       await this.log("Received focus response:", data.toString());
      //       resolve(JSON.parse(data.toString()));
      //     });
      //   });

      //   extension.end();

      //   if (focusResponse.error) {
      //     throw new Error(focusResponse.error);
      //   }

      //   return {
      //     content: [
      //       {
      //         type: "text",
      //         text: `Successfully focused existing VS Code window for project: ${projectPath}`,
      //       },
      //     ],
      //   };
      // }

      // If not found directly, check for parent/child relationship
      // for (const [workspace, port] of Object.entries(registry)) {
      //   if (
      //     absolutePath.startsWith(workspace + path.sep) ||
      //     workspace.startsWith(absolutePath + path.sep)
      //   ) {
      //     await this.log(`Found related workspace with port ${port}`);

      //     // Connect to the existing VS Code instance
      //     const extension = await this.connectToPort(port);

      //     // Focus the window
      //     const focusCommand = JSON.stringify({
      //       type: "focusWindow",
      //     });

      //     extension.write(focusCommand);

      //     const focusResponse = await new Promise<{
      //       success: boolean;
      //       error?: string;
      //     }>((resolve) => {
      //       extension.once("data", async (data) => {
      //         await this.log("Received focus response:", data.toString());
      //         resolve(JSON.parse(data.toString()));
      //       });
      //     });

      //     extension.end();

      //     if (focusResponse.error) {
      //       throw new Error(focusResponse.error);
      //     }

      //     return {
      //       content: [
      //         {
      //           type: "text",
      //           text: `Successfully focused existing VS Code window containing related project: ${projectPath}`,
      //         },
      //       ],
      //     };
      //   }
      // }

      // If the project is not in the registry, try to open it using any available port
      if (Object.keys(registry).length > 0) {
        // Use the first available port
        const anyPort = Object.values(registry)[0]
        await this.log(`Using available port ${anyPort} to open new project`)

        const extension = await this.connectToPort(anyPort)

        // Send command to open the folder in a new window
        const openCommand = JSON.stringify({
          type: 'openFolder',
          folderPath: absolutePath,
          newWindow: newWindow,
        })

        extension.write(openCommand)

        const openResponse = await new Promise<{
          success: boolean
          error?: string
        }>((resolve) => {
          extension.once('data', async (data) => {
            await this.log('Received open response:', data.toString())
            resolve(JSON.parse(data.toString()))
          })
        })

        extension.end()

        if (openResponse.error) {
          throw new Error(openResponse.error)
        }

        return {
          content: [
            {
              type: 'text',
              text: `Successfully opened project in a ${
                newWindow ? 'new' : 'current'
              } VS Code window: ${projectPath}`,
            },
          ],
        }
      }

      // If no ports are available, VS Code is not running
      return {
        content: [
          {
            type: 'text',
            text: 'VS Code does not appear to be running. Please start VS Code and open your project folder, then try again.',
          },
        ],
      }
    } catch (error) {
      await this.log('Error opening project:', error)
      return {
        content: [
          {
            type: 'text',
            text: `Error opening project: ${error}`,
          },
        ],
      }
    }
  }

  private async listAvailableProjects(): Promise<any> {
    try {
      await this.log('Listing available projects from registry')

      const registry = await this.findExtensionRegistry()

      if (!registry || Object.keys(registry).length === 0) {
        await this.log('No projects found in registry')
        return {
          content: [
            {
              type: 'text',
              text: 'No VS Code projects found. Please make sure the VS Code MCP Extension is installed and you have at least one project open in VS Code.',
            },
          ],
        }
      }

      // Format the list of projects
      const projectPaths = Object.keys(registry)
      const projectsList = projectPaths
        .map((path, index) => `${index + 1}. ${path}`)
        .join('\n')

      return {
        content: [
          {
            type: 'text',
            text: `Available projects:\n\n${projectsList}\n\nPlease choose one of these projects. Whichever project you choose will be used as your Project Path (i.e. targetProjectPath) in subsequent tool calls.`,
          },
        ],
      }
    } catch (error) {
      await this.log('Error listing available projects:', error)
      return {
        content: [
          {
            type: 'text',
            text: `Error listing available projects: ${error}`,
          },
        ],
      }
    }
  }

  public async start() {
    await this.log('Starting VS Code MCP Server...')
    const transport = new StdioServerTransport()
    await this.log('MCP Server starting with stdio transport')

    await this.server.connect(transport)
    await this.log('VS Code MCP Server started successfully')
  }
}

// Export the startServer function for CLI usage
export function startServer() {
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
