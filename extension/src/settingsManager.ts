import * as vscode from 'vscode'

export interface MCPSettings {
  diffing: {
    enabled: boolean
  }
  fileOpening: {
    enabled: boolean
  }
}

export class SettingsManager {
  private static instance: SettingsManager
  private _context: vscode.ExtensionContext

  private constructor(context: vscode.ExtensionContext) {
    this._context = context
  }

  public static getInstance(context?: vscode.ExtensionContext): SettingsManager {
    if (!SettingsManager.instance && context) {
      SettingsManager.instance = new SettingsManager(context)
    }

    if (!SettingsManager.instance) {
      throw new Error('SettingsManager not initialized')
    }

    return SettingsManager.instance
  }

  public getSettings(): MCPSettings {
    return this._context.globalState.get<MCPSettings>('mcpSettings') || this.getDefaultSettings()
  }

  public async updateSettings(settings: MCPSettings): Promise<void> {
    await this._context.globalState.update('mcpSettings', settings)
  }

  public getDefaultSettings(): MCPSettings {
    return {
      diffing: {
        enabled: true,
      },
      fileOpening: {
        enabled: true,
      },
    }
  }
}
