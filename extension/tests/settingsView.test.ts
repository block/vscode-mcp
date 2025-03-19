import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SettingsViewProvider } from '../src/settingsView'
import { SettingsManager } from '../src/settingsManager'
import * as vscode from 'vscode'
import * as fs from 'fs'

// Create a spy for SettingsManager.updateSettings
const updateSettingsSpy = vi.fn().mockResolvedValue(undefined)

// Mock vscode
vi.mock('vscode', () => ({
  Uri: {
    joinPath: vi.fn().mockImplementation((...args) => ({ fsPath: args.join('/') })),
  },
  WebviewViewResolveContext: {},
  WebviewView: {},
  Webview: {},
  WebviewOptions: {},
  CancellationToken: {},
}))

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src {{cspSource}}; script-src 'nonce-{{nonce}}';">
        <link href="{{styleUri}}" rel="stylesheet">
      </head>
      <body>
        <div class="container">
          <h2>MCP Settings</h2>
          <!-- Settings content -->
        </div>
        <script nonce="{{nonce}}" src="{{scriptUri}}"></script>
      </body>
    </html>
  `),
}))

// Mock SettingsManager
vi.mock('../src/settingsManager', () => {
  const settings = {
    diffing: { enabled: true },
    fileOpening: { enabled: true },
  }

  return {
    SettingsManager: {
      getInstance: vi.fn().mockImplementation(() => ({
        getSettings: vi.fn().mockReturnValue(settings),
        updateSettings: updateSettingsSpy,
      })),
    },
  }
})

describe('SettingsViewProvider', () => {
  let settingsViewProvider: SettingsViewProvider
  let mockExtensionUri: vscode.Uri
  let mockContext: vscode.ExtensionContext
  let mockWebviewView: any
  let mockWebview: any
  let onDidReceiveMessageCallback: any

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Create mock extension URI
    mockExtensionUri = { fsPath: '/extension/uri' } as vscode.Uri

    // Create mock context
    mockContext = {
      extensionUri: mockExtensionUri,
      subscriptions: [],
    } as unknown as vscode.ExtensionContext

    // Create mock webview
    mockWebview = {
      html: '',
      options: {},
      onDidReceiveMessage: vi.fn().mockImplementation(callback => {
        onDidReceiveMessageCallback = callback
        return { dispose: vi.fn() }
      }),
      postMessage: vi.fn().mockResolvedValue(true),
      asWebviewUri: vi.fn().mockImplementation(uri => uri),
      cspSource: 'mock-csp-source',
    }

    // Create mock webview view
    mockWebviewView = {
      webview: mockWebview,
    }

    // Create settings view provider
    settingsViewProvider = new SettingsViewProvider(mockExtensionUri, mockContext)
  })

  it('should initialize the webview with HTML content', () => {
    // Call resolveWebviewView
    settingsViewProvider.resolveWebviewView(
      mockWebviewView as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    )

    // Check that HTML was set
    expect(mockWebview.html).toBeTruthy()

    // Verify that the HTML contains placeholders that were replaced
    expect(mockWebview.html).toContain('mock-csp-source')
    expect(mockWebview.html).not.toContain('{{cspSource}}')

    // Verify that scripts are enabled
    expect(mockWebview.options.enableScripts).toBe(true)
  })

  it('should handle updateSettings message', async () => {
    // Call resolveWebviewView to set up the webview
    settingsViewProvider.resolveWebviewView(
      mockWebviewView as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    )

    // Create settings update message
    const settings = {
      diffing: { enabled: false },
      fileOpening: { enabled: true },
    }

    // Call the message handler callback directly
    await onDidReceiveMessageCallback({
      command: 'updateSettings',
      settings,
    })

    // Verify updateSettings was called with correct settings
    expect(updateSettingsSpy).toHaveBeenCalledWith(settings)
  })

  it('should handle getSettings message', async () => {
    // Get the SettingsManager mock
    const settingsManager = SettingsManager.getInstance()
    const settings = settingsManager.getSettings()

    // Call resolveWebviewView to set up the webview
    settingsViewProvider.resolveWebviewView(
      mockWebviewView as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    )

    // Call the message handler callback directly
    await onDidReceiveMessageCallback({
      command: 'getSettings',
    })

    // Verify postMessage was called with correct settings
    expect(mockWebview.postMessage).toHaveBeenCalledWith({
      command: 'setSettings',
      settings,
    })
  })

  it('should handle errors when reading HTML template', () => {
    // Make readFileSync throw an error
    ;(fs.readFileSync as any).mockImplementationOnce(() => {
      throw new Error('File not found')
    })

    // Call resolveWebviewView
    settingsViewProvider.resolveWebviewView(
      mockWebviewView as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    )

    // Check that error HTML was set
    expect(mockWebview.html).toContain('Error loading settings')
    expect(mockWebview.html).toContain('There was an error loading the settings view')
  })
})
