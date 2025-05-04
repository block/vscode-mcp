import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Find the extension registry file
async function findExtensionRegistry() {
  try {
    const registryLocations = [
      path.join(os.tmpdir(), 'ag-vscode-mcp-extension-registry.json'),
      '/tmp/ag-vscode-mcp-extension-registry.json',
    ];
    
    let registry = null;
    
    // Try to read the registry from any available location
    for (const registryPath of registryLocations) {
      try {
        const content = await fs.readFile(registryPath, 'utf-8');
        registry = JSON.parse(content);
        console.log('Found extension registry at:', registryPath);
        break;
      } catch (error) {
        console.log('Could not read registry from:', registryPath);
      }
    }
    
    if (!registry) {
      console.error('Could not find extension registry in any location');
    }
    
    return registry;
  } catch (error) {
    console.error('Error reading extension registry:', error);
    return null;
  }
}

// Find the extension port
async function findExtensionPort(targetProjectPath) {
  try {
    const registry = await findExtensionRegistry();
    
    if (!registry) {
      return null;
    }
    
    // If we have a target project path, try to find a matching extension instance
    if (targetProjectPath) {
      const absolutePath = path.isAbsolute(targetProjectPath) 
        ? targetProjectPath 
        : path.resolve(targetProjectPath);
      
      console.log('Looking for workspace:', absolutePath);
      console.log('Registry entries:', Object.keys(registry));
      
      // First, look for an exact match
      if (registry[absolutePath]) {
        const port = registry[absolutePath];
        console.log(`Found exact workspace match with port ${port}`);
        return port;
      }
      
      // Next, look for a parent/child relationship
      for (const [workspace, port] of Object.entries(registry)) {
        console.log(`Checking workspace: ${workspace}`);
        if (absolutePath.startsWith(workspace + path.sep) || workspace.startsWith(absolutePath + path.sep)) {
          console.log(`Found related workspace match with port ${port}`);
          return port;
        }
      }
      
      console.log('No matching workspace found in registry');
      
      // If no match found, return the first port in the registry
      console.log('Using first port from registry');
      return Object.values(registry)[0];
    }
    
    // If no target workspace, return the first port in the registry
    return Object.values(registry)[0];
  } catch (error) {
    console.error('Error finding extension port:', error);
    return null;
  }
}

// Test connection to VSCode extension
async function testConnection() {
  try {
    // Get the current working directory
    const cwd = process.cwd();
    console.log('Current working directory:', cwd);
    
    // Find the VSCode extension port for this workspace
    const port = await findExtensionPort(cwd);
    
    if (!port) {
      console.error('No port found for VSCode extension');
      return;
    }
    
    console.log(`Connecting to VSCode extension on port: ${port}`);
    
    // Create a socket connection
    const socket = new net.Socket();
    
    socket.connect(port, '127.0.0.1', () => {
      console.log('Connected to VSCode extension');
      
      // Create the test file path
      const testFilePath = path.resolve(cwd, 'test_file.md');
      console.log('Test file path:', testFilePath);
      
      // Test 1: Ping command
      console.log('\n--- Sending ping command ---');
      const pingCommand = {
        id: 'ping_1',
        type: 'ping'
      };
      socket.write(JSON.stringify(pingCommand));
      
      // Test 2: Open file command after ping response
      setTimeout(() => {
        console.log('\n--- Sending open command ---');
        const openCommand = {
          id: 'open_1',
          type: 'open',
          filePath: testFilePath
        };
        socket.write(JSON.stringify(openCommand));
      }, 1000);
      
      // Test 3: Get current workspace
      setTimeout(() => {
        console.log('\n--- Sending getCurrentWorkspace command ---');
        const workspaceCommand = {
          id: 'workspace_1',
          type: 'getCurrentWorkspace'
        };
        socket.write(JSON.stringify(workspaceCommand));
      }, 2000);
      
      // Close the connection after tests
      setTimeout(() => {
        console.log('\nTests completed, closing connection');
        socket.end();
      }, 3000);
    });
    
    // Handle data received from the server
    socket.on('data', (data) => {
      console.log('Response:', data.toString());
    });
    
    // Handle connection errors
    socket.on('error', (error) => {
      console.error('Connection error:', error);
    });
    
    // Handle connection close
    socket.on('close', () => {
      console.log('Connection closed');
    });
  } catch (error) {
    console.error('Error testing connection:', error);
  }
}

// Create a test file
async function createTestFile() {
  try {
    const cwd = process.cwd();
    const testFilePath = path.resolve(cwd, 'test_file.md');
    const content = '# Test File\n\nThis is a test file created by the VSCode MCP test script.\n';
    
    await fs.writeFile(testFilePath, content);
    console.log('Created test file at:', testFilePath);
  } catch (error) {
    console.error('Error creating test file:', error);
  }
}

// Run the test
async function run() {
  await createTestFile();
  await testConnection();
}

run().catch(error => {
  console.error('Error running test:', error);
});
