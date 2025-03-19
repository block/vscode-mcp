import * as vscode from 'vscode'
import * as fs from 'fs'
import { SettingsManager } from './settingsManager'

export class SettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mcp-settings'
  private _view?: vscode.WebviewView
  private settingsManager: SettingsManager

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {
    this.settingsManager = SettingsManager.getInstance(_context)
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      // Enable JavaScript in the webview
      enableScripts: true,
      // Restrict the webview to only load resources from the extension's directory
      localResourceRoots: [this._extensionUri],
    }

    // Set the webview's initial HTML content
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'updateSettings': {
            // Save settings to global state through the manager
            await this.settingsManager.updateSettings(message.settings)
            break
          }
          case 'getSettings': {
            // Send settings to the webview from the manager
            const settings = this.settingsManager.getSettings()
            webviewView.webview.postMessage({ command: 'setSettings', settings })
            break
          }
        }
      },
      undefined,
      this._context.subscriptions
    )
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Get the local path to main script, CSS, and HTML template
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'settingsView.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'settingsView.css'))
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'settingsView.html').fsPath

    // Use a nonce to only allow a specific script to be run
    const nonce = getNonce()

    try {
      // Read the HTML template
      let html = fs.readFileSync(htmlPath, 'utf8')

      // Replace placeholders with actual values
      html = html
        .replace(/{{scriptUri}}/g, scriptUri.toString())
        .replace(/{{styleUri}}/g, styleUri.toString())
        .replace(/{{nonce}}/g, nonce)
        .replace(/{{cspSource}}/g, webview.cspSource)

      return html
    } catch (error) {
      console.error('Error loading settings view HTML template:', error)
      return `<!DOCTYPE html>
        <html>
          <body>
            <h2>Error loading settings</h2>
            <p>There was an error loading the settings view. Please try again later.</p>
          </body>
        </html>`
    }
  }
}

function getNonce() {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
