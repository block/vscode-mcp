import * as net from 'net';
import * as events from 'events';

interface ConnectionOptions {
  host: string;
  port: number;
  timeout?: number;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

class MCPConnectionHandler extends events.EventEmitter {
  private socket: net.Socket | null = null;
  private connectionOptions: ConnectionOptions;
  private connected: boolean = false;
  private reconnecting: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt: number = 0;
  private messageQueue: string[] = [];
  private pendingRequests: Map<string, { resolve: Function, reject: Function, timeout: NodeJS.Timeout }> = new Map();
  private requestCounter: number = 0;

  constructor(options: ConnectionOptions) {
    super();
    this.connectionOptions = {
      ...options,
      timeout: options.timeout || 10000,
      reconnectAttempts: options.reconnectAttempts || 5,
      reconnectDelay: options.reconnectDelay || 1000
    };
  }

  /**
   * Connect to the MCP server
   */
  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this.socket = new net.Socket();

        // Set up socket event handlers
        this.socket.on('connect', () => {
          this.connected = true;
          this.reconnectAttempt = 0;
          this.emit('connected');
          this.processQueue();
          resolve();
        });

        this.socket.on('data', (data) => {
          this.handleData(data);
        });

        this.socket.on('error', (err) => {
          console.error('Socket error:', err);
          this.emit('error', err);

          // Don't reject if we're already connected (handle as normal error)
          if (!this.connected) {
            reject(err);
          }
        });

        this.socket.on('close', (hadError) => {
          this.connected = false;
          this.socket = null;
          this.emit('disconnected', hadError);

          // Try to reconnect if not explicitly closed
          if (!this.reconnecting) {
            this.scheduleReconnect();
          }
        });

        // Connect to the server
        this.socket.connect({
          host: this.connectionOptions.host,
          port: this.connectionOptions.port
        });

        // Set connection timeout
        const timeout = setTimeout(() => {
          if (!this.connected) {
            this.socket?.destroy();
            reject(new Error('Connection timeout'));
          }
        }, this.connectionOptions.timeout);

        this.socket.once('connect', () => {
          clearTimeout(timeout);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the MCP server
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnecting = false;

    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }

    this.connected = false;

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Send a request to the MCP server and get a response
   */
  public async sendRequest<T = any>(type: string, payload: any, timeout: number = 10000): Promise<T> {
    const requestId = `req_${++this.requestCounter}`;
    const request = {
      id: requestId,
      type,
      ...payload
    };

    return new Promise<T>((resolve, reject) => {
      // Set up timeout for this request
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request timeout for ${type}`));
        }
      }, timeout);

      // Store the request callbacks
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutId
      });

      // Send the request
      this.send(JSON.stringify(request));
    });
  }

  /**
   * Send raw data to the MCP server
   */
  public send(data: string): void {
    if (!this.connected || !this.socket) {
      // Queue the message for later
      this.messageQueue.push(data);

      // Try to connect if not connected
      if (!this.connected && !this.reconnecting) {
        this.scheduleReconnect(0);
      }
      return;
    }

    try {
      this.socket.write(data);
    } catch (error) {
      console.error('Error sending data:', error);
      this.emit('error', error);

      // Queue the message for retry
      this.messageQueue.push(data);

      // Force reconnect
      if (this.socket) {
        this.socket.destroy();
      }
    }
  }

  /**
   * Process the message queue after reconnecting
   */
  private processQueue(): void {
    // Process any queued messages
    if (this.messageQueue.length > 0 && this.connected && this.socket) {
      console.log(`Processing ${this.messageQueue.length} queued messages`);

      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message && this.socket) {
          try {
            this.socket.write(message);
          } catch (error) {
            console.error('Error sending queued message:', error);
            // Put the message back at the front of the queue
            this.messageQueue.unshift(message);
            break;
          }
        }
      }
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(delay?: number): void {
    if (this.reconnecting || this.reconnectTimer) {
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempt++;

    // Calculate delay with exponential backoff if not specified
    const reconnectDelay = delay !== undefined ?
      delay :
      Math.min(
        this.connectionOptions.reconnectDelay! * Math.pow(2, this.reconnectAttempt - 1),
        30000 // Max 30 seconds
      );

    console.log(`Scheduling reconnect attempt ${this.reconnectAttempt} in ${reconnectDelay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this.reconnectAttempt > this.connectionOptions.reconnectAttempts!) {
        console.error(`Failed to reconnect after ${this.reconnectAttempt - 1} attempts`);
        this.emit('reconnectFailed');
        this.reconnecting = false;
        return;
      }

      try {
        console.log(`Attempting to reconnect (${this.reconnectAttempt}/${this.connectionOptions.reconnectAttempts})`);
        await this.connect();
        this.reconnecting = false;
        this.emit('reconnected', this.reconnectAttempt);
      } catch (error) {
        console.error('Reconnect attempt failed:', error);
        this.scheduleReconnect();
      }
    }, reconnectDelay);
  }

  /**
   * Handle incoming data from the MCP server
   */
  private handleData(data: Buffer): void {
    try {
      // Handle the case where multiple messages are received together
      const messages = data.toString().split('\n').filter(msg => msg.trim().length > 0);

      for (const message of messages) {
        try {
          const response = JSON.parse(message);

          // Check if this is a response to a request
          if (response.id && this.pendingRequests.has(response.id)) {
            const request = this.pendingRequests.get(response.id)!;
            clearTimeout(request.timeout);

            if (response.error) {
              // Handle specific error codes
              if (response.error.code === -32000) {
                // Connection closed error
                this.emit('connectionClosedError', response.error);
                request.reject(new Error(`MCP connection closed: ${response.error.message}`));
              } else {
                request.reject(new Error(response.error.message || 'Unknown error'));
              }
            } else {
              request.resolve(response.result || response);
            }

            this.pendingRequests.delete(response.id);
          } else {
            // This is a notification or an event
            this.emit('message', response);

            // Also emit a specific event based on the message type
            if (response.type) {
              this.emit(response.type, response);
            }
          }
        } catch (parseError) {
          console.error('Error parsing message:', parseError, 'Raw message:', message);
          this.emit('parseError', parseError, message);
        }
      }
    } catch (error) {
      console.error('Error handling data:', error);
      this.emit('error', error);
    }
  }

  /**
   * Check if the connection is alive
   */
  public async ping(timeout: number = 5000): Promise<boolean> {
    try {
      const start = Date.now();
      const response = await this.sendRequest<{ alive: boolean }>('ping', {}, timeout);
      const elapsed = Date.now() - start;

      this.emit('pingResponse', { elapsed, response });
      return response && response.alive === true;
    } catch (error) {
      console.error('Ping failed:', error);
      return false;
    }
  }

  /**
   * Reconnect forcefully, even if currently connected
   */
  public async forceReconnect(): Promise<void> {
    console.log('Force reconnecting...');

    // Disconnect first
    this.disconnect();

    // Reset reconnect attempt counter to start with minimal delay
    this.reconnectAttempt = 0;

    // Try to reconnect immediately
    try {
      await this.connect();
    } catch (error) {
      console.error('Force reconnect initial attempt failed:', error);
      // Schedule normal reconnect process
      this.scheduleReconnect(0);
    }
  }

  /**
   * Handle specific MCP error -32000: Connection closed
   * This method implements special handling for this specific error
   */
  public async handleConnectionClosedError(): Promise<boolean> {
    console.log('Handling MCP connection closed error (-32000)');

    try {
      // Force reconnect to the server
      await this.forceReconnect();

      // Verify connection is healthy with a ping
      const isHealthy = await this.ping();

      if (!isHealthy) {
        throw new Error('Connection is not healthy after reconnect');
      }

      return true;
    } catch (error) {
      console.error('Failed to recover from connection closed error:', error);
      return false;
    }
  }
}

// Debug session manager that uses the improved connection handler
class DebugSessionManager {
  private connection: MCPConnectionHandler;
  private projectPath: string;
  private activeSessionId: string | null = null;
  private breakpoints: Map<number, any> = new Map();

  constructor(projectPath: string, connectionOptions: ConnectionOptions) {
    this.projectPath = projectPath;
    this.connection = new MCPConnectionHandler(connectionOptions);

    // Set up connection event handlers
    this.connection.on('connectionClosedError', async (error) => {
      console.log('Debug session manager detected connection closed error:', error);
      await this.handleConnectionClosed();
    });

    this.connection.on('reconnected', async (attempt) => {
      console.log(`Debug session manager reconnected after ${attempt} attempts`);

      // Check if we had an active debug session and try to restore it
      if (this.activeSessionId) {
        await this.restoreDebugSession();
      }
    });
  }

  /**
   * Start a debug session
   */
  public async startDebug(config: string | object): Promise<{ sessionId: string }> {
    try {
      await this.ensureConnected();

      const response = await this.connection.sendRequest<{ sessionId: string }>('startDebug', {
        projectPath: this.projectPath,
        config
      });

      this.activeSessionId = response.sessionId;
      return response;
    } catch (error) {
      if (this.isConnectionClosedError(error)) {
        // Try once more after handling connection closed error
        await this.handleConnectionClosed();
        return this.startDebug(config);
      }
      throw error;
    }
  }

  /**
   * Stop the current debug session
   */
  public async stopDebug(): Promise<boolean> {
    try {
      if (!this.activeSessionId) {
        return false;
      }

      await this.ensureConnected();

      const response = await this.connection.sendRequest<{ success: boolean }>('stopDebug', {
        projectPath: this.projectPath,
        sessionId: this.activeSessionId
      });

      if (response.success) {
        this.activeSessionId = null;
        this.breakpoints.clear();
      }

      return response.success;
    } catch (error) {
      if (this.isConnectionClosedError(error)) {
        // Try once more after handling connection closed error
        await this.handleConnectionClosed();
        return this.stopDebug();
      }
      throw error;
    }
  }

  /**
   * Set a breakpoint
   */
  public async setBreakpoint(filePath: string, line: number, options?: {
    condition?: string;
    logMessage?: string;
    hitCondition?: string;
  }): Promise<{ breakpointId: number, verified: boolean }> {
    try {
      await this.ensureConnected();

      const response = await this.connection.sendRequest<{ breakpointId: number, verified: boolean }>('setBreakpoint', {
        projectPath: this.projectPath,
        sessionId: this.activeSessionId,
        filePath,
        line,
        ...options
      });

      // Store breakpoint for potential restoration
      this.breakpoints.set(response.breakpointId, {
        filePath,
        line,
        ...options,
        verified: response.verified
      });

      return response;
    } catch (error) {
      if (this.isConnectionClosedError(error)) {
        // Try once more after handling connection closed error
        await this.handleConnectionClosed();
        return this.setBreakpoint(filePath, line, options);
      }
      throw error;
    }
  }

  /**
   * Check if an error is a connection closed error
   */
  private isConnectionClosedError(error: any): boolean {
    return error &&
           error.message &&
           (error.message.includes('-32000') ||
            error.message.includes('Connection closed'));
  }

  /**
   * Ensure we have an active connection
   */
  private async ensureConnected(): Promise<void> {
    if (!this.connection) {
      throw new Error('No connection handler available');
    }

    try {
      await this.connection.connect();
    } catch (error) {
      console.error('Failed to ensure connection:', error);
      throw error;
    }
  }

  /**
   * Handle connection closed error
   */
  private async handleConnectionClosed(): Promise<void> {
    try {
      const success = await this.connection.handleConnectionClosedError();

      if (!success) {
        throw new Error('Failed to recover from connection closed error');
      }

      // If we have an active session, try to restore it
      if (this.activeSessionId) {
        await this.restoreDebugSession();
      }
    } catch (error) {
      console.error('Error handling connection closed:', error);
      throw error;
    }
  }

  /**
   * Restore debug session after reconnection
   */
  private async restoreDebugSession(): Promise<boolean> {
    try {
      console.log('Attempting to restore debug session after reconnection');

      // First check if the session is still active on the server
      const response = await this.connection.sendRequest<{ active: boolean }>('checkDebugSession', {
        projectPath: this.projectPath,
        sessionId: this.activeSessionId
      });

      if (!response.active) {
        console.log('Debug session is no longer active on the server, cannot restore');
        this.activeSessionId = null;
        return false;
      }

      // If we have breakpoints, restore them
      if (this.breakpoints.size > 0) {
        console.log(`Restoring ${this.breakpoints.size} breakpoints`);

        for (const [id, bp] of this.breakpoints) {
          try {
            await this.connection.sendRequest('restoreBreakpoint', {
              projectPath: this.projectPath,
              sessionId: this.activeSessionId,
              breakpointId: id,
              filePath: bp.filePath,
              line: bp.line,
              condition: bp.condition,
              logMessage: bp.logMessage,
              hitCondition: bp.hitCondition
            });
          } catch (error) {
            console.error(`Failed to restore breakpoint ${id}:`, error);
            // Continue with other breakpoints
          }
        }
      }

      console.log('Debug session restored successfully');
      return true;
    } catch (error) {
      console.error('Failed to restore debug session:', error);
      this.activeSessionId = null;
      return false;
    }
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.connection) {
      this.connection.disconnect();
    }

    this.activeSessionId = null;
    this.breakpoints.clear();
  }
}

export { MCPConnectionHandler, DebugSessionManager, ConnectionOptions };
