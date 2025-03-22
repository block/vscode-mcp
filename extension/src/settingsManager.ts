import * as vscode from 'vscode'

export interface MCPSettings {
  diffing: {
    enabled: boolean
  }
  fileOpening: {
    enabled: boolean
  }
  shellCommands: {
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
    const defaultSettings = this.getDefaultSettings()
    const savedSettings = this._context.globalState.get<Partial<MCPSettings>>('mcpSettings') || {}

    // Merge default settings with saved settings, ensuring all properties exist
    return {
      diffing: {
        enabled: savedSettings.diffing?.enabled ?? defaultSettings.diffing.enabled,
      },
      fileOpening: {
        enabled: savedSettings.fileOpening?.enabled ?? defaultSettings.fileOpening.enabled,
      },
      shellCommands: {
        enabled: savedSettings.shellCommands?.enabled ?? defaultSettings.shellCommands.enabled,
      },
    }
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
      shellCommands: {
        enabled: true,
      },
    }
  }
}
