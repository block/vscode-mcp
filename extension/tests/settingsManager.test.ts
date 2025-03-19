import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SettingsManager, MCPSettings } from '../src/settingsManager'
import * as vscode from 'vscode'

// Mock vscode
vi.mock('vscode', () => ({
  ExtensionContext: {},
}))

describe('SettingsManager', () => {
  // Mock context
  let mockContext: vscode.ExtensionContext
  let mockGlobalState: any

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Create mock global state
    mockGlobalState = {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    }

    // Create mock context
    mockContext = {
      globalState: mockGlobalState,
    } as unknown as vscode.ExtensionContext
  })

  afterEach(() => {
    // Reset the singleton instance between tests
    // @ts-ignore - accessing private property for testing
    SettingsManager['instance'] = undefined
  })

  it('should create a singleton instance', () => {
    const instance1 = SettingsManager.getInstance(mockContext)
    const instance2 = SettingsManager.getInstance()

    expect(instance1).toBeDefined()
    expect(instance2).toBeDefined()
    expect(instance1).toBe(instance2)
  })

  it('should throw an error if getInstance is called without context before initialization', () => {
    // Reset the singleton instance
    // @ts-ignore - accessing private property for testing
    SettingsManager['instance'] = undefined

    expect(() => SettingsManager.getInstance()).toThrow('SettingsManager not initialized')
  })

  it('should return default settings if none are saved', () => {
    mockGlobalState.get.mockReturnValue(null)

    const settingsManager = SettingsManager.getInstance(mockContext)
    const settings = settingsManager.getSettings()

    expect(settings).toEqual({
      diffing: {
        enabled: true,
      },
      fileOpening: {
        enabled: true,
      },
    })

    expect(mockGlobalState.get).toHaveBeenCalledWith('mcpSettings')
  })

  it('should return saved settings from global state', () => {
    const savedSettings: MCPSettings = {
      diffing: {
        enabled: false,
      },
      fileOpening: {
        enabled: true,
      },
    }

    mockGlobalState.get.mockReturnValue(savedSettings)

    const settingsManager = SettingsManager.getInstance(mockContext)
    const settings = settingsManager.getSettings()

    expect(settings).toEqual(savedSettings)
    expect(mockGlobalState.get).toHaveBeenCalledWith('mcpSettings')
  })

  it('should update settings in global state', async () => {
    const newSettings: MCPSettings = {
      diffing: {
        enabled: false,
      },
      fileOpening: {
        enabled: false,
      },
    }

    const settingsManager = SettingsManager.getInstance(mockContext)
    await settingsManager.updateSettings(newSettings)

    expect(mockGlobalState.update).toHaveBeenCalledWith('mcpSettings', newSettings)
  })
})
