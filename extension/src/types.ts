import * as vscode from 'vscode'

// Command type as a union of string literals
export type CommandType = 'showDiff' | 'open' | 'openFolder' | 'getCurrentWorkspace' | 'ping' | 'focusWindow' | 'getActiveTabs' | 'getContextTabs'

// Base command interface
export interface Command {
  type: CommandType
}

// Command types
export interface ShowDiffCommand extends Command {
  type: 'showDiff'
  originalPath: string
  modifiedPath: string
  title: string
}

export interface OpenCommand extends Command {
  type: 'open'
  filePath: string
  options?: vscode.TextDocumentShowOptions
}

export interface OpenFolderCommand extends Command {
  type: 'openFolder'
  folderPath: string
  newWindow?: boolean
}

export interface GetCurrentWorkspaceCommand extends Command {
  type: 'getCurrentWorkspace'
}

export interface PingCommand extends Command {
  type: 'ping'
}

export interface FocusWindowCommand extends Command {
  type: 'focusWindow'
}

export interface GetActiveTabsCommand extends Command {
  type: 'getActiveTabs'
  includeContent?: boolean
}

export interface GetContextTabsCommand extends Command {
  type: 'getContextTabs'
  includeContent?: boolean
}

// Type union of all possible commands
export type CommandUnion =
  | ShowDiffCommand
  | OpenCommand
  | OpenFolderCommand
  | GetCurrentWorkspaceCommand
  | PingCommand
  | FocusWindowCommand
  | GetActiveTabsCommand
  | GetContextTabsCommand

// Response interfaces
export interface BaseResponse {
  success: boolean
  error?: string
}

export interface DiffResponse extends BaseResponse {
  accepted?: boolean
}

export interface WorkspaceResponse extends BaseResponse {
  workspaces?: string[]
}

export interface ActiveTabsResponse extends BaseResponse {
  tabs?: Array<{
    filePath: string
    isActive: boolean
    languageId?: string
    content?: string
  }>
}

// The following type guards are kept for backward compatibility
// but are less necessary with the improved type system

export function isShowDiffCommand(command: Command): command is ShowDiffCommand {
  return command.type === 'showDiff'
}

export function isOpenCommand(command: Command): command is OpenCommand {
  return command.type === 'open'
}

export function isOpenFolderCommand(command: Command): command is OpenFolderCommand {
  return command.type === 'openFolder'
}

export function isGetCurrentWorkspaceCommand(command: Command): command is GetCurrentWorkspaceCommand {
  return command.type === 'getCurrentWorkspace'
}

export function isPingCommand(command: Command): command is PingCommand {
  return command.type === 'ping'
}

export function isFocusWindowCommand(command: Command): command is FocusWindowCommand {
  return command.type === 'focusWindow'
}

export function isGetActiveTabsCommand(command: Command): command is GetActiveTabsCommand {
  return command.type === 'getActiveTabs'
}

export function isGetContextTabsCommand(command: Command): command is GetContextTabsCommand {
  return command.type === 'getContextTabs'
}
