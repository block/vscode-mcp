// Get VS Code API
const vscode = acquireVsCodeApi()

// DOM elements
const diffingEnabledCheckbox = document.getElementById('diffing-enabled')
const fileOpeningEnabledCheckbox = document.getElementById('file-opening-enabled')
const shellCommandsEnabledCheckbox = document.getElementById('shell-commands-enabled')

// Current settings state
let settings = {
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

// Initialize settings
initializeSettings()

// Add event listeners for settings changes - now with auto-save
diffingEnabledCheckbox.addEventListener('change', saveSettingsOnChange)
fileOpeningEnabledCheckbox.addEventListener('change', saveSettingsOnChange)
shellCommandsEnabledCheckbox.addEventListener('change', saveSettingsOnChange)

// Request current settings when the webview loads
function initializeSettings() {
  // Request settings from extension
  vscode.postMessage({
    command: 'getSettings',
  })

  // Listen for messages from the extension
  window.addEventListener('message', event => {
    const message = event.data

    switch (message.command) {
      case 'setSettings':
        settings = message.settings
        updateUIFromSettings()
        break
    }
  })
}

// Update the UI based on the current settings
function updateUIFromSettings() {
  diffingEnabledCheckbox.checked = settings.diffing.enabled
  fileOpeningEnabledCheckbox.checked = settings.fileOpening.enabled
  shellCommandsEnabledCheckbox.checked = settings.shellCommands.enabled
}

// Update settings and save immediately when a checkbox is toggled
function saveSettingsOnChange() {
  // Update the settings object based on the UI state
  settings.diffing.enabled = diffingEnabledCheckbox.checked
  settings.fileOpening.enabled = fileOpeningEnabledCheckbox.checked
  settings.shellCommands.enabled = shellCommandsEnabledCheckbox.checked

  // Save settings to extension
  vscode.postMessage({
    command: 'updateSettings',
    settings: settings,
  })
}
