// This file is used for any global test setup
import { vi } from 'vitest'

// Set up global mocks here if needed
global.console = {
  ...console,
  // You can modify logging behavior for tests here
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}
