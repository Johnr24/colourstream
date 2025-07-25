import OBSWebSocket from 'obs-websocket-js';
import { logger } from '../utils/logger';
import WebSocketService from './websocket';

export class OBSWebSocketService {
  private obs: OBSWebSocket;
  private wsService: WebSocketService;
  private connectionStatus: 'disconnected' | 'connected' | 'connecting' | 'error' = 'disconnected';
  private lastError: string | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private lastConnectionSettings: { host: string; port: number; password?: string } | null = null;

  constructor(wsService: WebSocketService) {
    this.obs = new OBSWebSocket();
    this.wsService = wsService;
    this.setupEventHandlers();
    logger.info('OBS WebSocket service initialized');
  }

  private setupEventHandlers() {
    this.obs.on('ConnectionOpened', () => {
      logger.info('OBS WebSocket connection opened');
      this.updateStatus('connecting');
    });

    this.obs.on('Hello', (data) => {
      logger.info('Received Hello from OBS WebSocket server:', data);
    });

    this.obs.on('Identified', () => {
      logger.info('Successfully connected and identified with OBS');
      this.connectionStatus = 'connected';
      this.lastError = null;
      this.reconnectAttempts = 0;
      this.broadcastStatus();
      this.startConnectionCheck();
    });

    this.obs.on('ConnectionClosed', () => {
      logger.warn('OBS WebSocket connection closed');
      this.connectionStatus = 'disconnected';
      this.broadcastStatus();
      this.stopConnectionCheck();
      this.attemptReconnect();
    });

    this.obs.on('ConnectionError', (err: Error) => {
      logger.error('OBS WebSocket connection error:', err);
      this.connectionStatus = 'error';
      this.lastError = err.message;
      this.broadcastStatus();
      this.stopConnectionCheck();
      this.attemptReconnect();
    });
  }

  private broadcastStatus() {
    this.wsService.broadcastOBSStatus({
      type: 'obs_status',
      status: this.connectionStatus,
      ...(this.lastError && { error: this.lastError })
    });
    logger.debug(`Broadcasting OBS status: ${this.connectionStatus}${this.lastError ? ` (Error: ${this.lastError})` : ''}`);
  }

  private startConnectionCheck() {
    // Stop any existing interval
    this.stopConnectionCheck();
    
    // Start a new interval to periodically check the connection
    this.connectionCheckInterval = setInterval(async () => {
      if (this.connectionStatus === 'connected') {
        try {
          const { obsVersion } = await this.obs.call('GetVersion');
          logger.debug(`OBS connection check successful - OBS version: ${obsVersion}`);
        } catch (error) {
          logger.error('OBS connection check failed:', error);
          this.connectionStatus = 'error';
          this.lastError = 'Connection check failed';
          this.broadcastStatus();
          this.stopConnectionCheck();
          this.attemptReconnect();
        }
      }
    }, 30000); // Check every 30 seconds
    
    logger.debug('Started OBS connection check interval');
  }

  private stopConnectionCheck() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
      logger.debug('Stopped OBS connection check interval');
    }
  }

  private attemptReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 60000);
    this.reconnectAttempts++;
    
    logger.info(`Scheduling OBS reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimeout = setTimeout(() => {
      logger.info(`Attempting to reconnect to OBS (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.connect().catch(error => {
        logger.error('Reconnection attempt failed:', error);
      });
    }, delay);
  }

  public async connect(settings?: { host: string; port: number; password?: string }): Promise<void> {
    try {
      if (settings) {
        const { host, port, password } = settings;
        const url = `ws://${host}:${port}`;
        
        logger.info(`Connecting to OBS at ${url}${password ? ' with authentication' : ''}`);
        this.updateStatus('connecting');
        
        try {
          // Connect to OBS WebSocket v5
          // The library handles the authentication process internally
          // Make sure we're passing the password correctly
          if (password && password.trim() !== '') {
            logger.info('Connecting with password authentication');
            await this.obs.connect(url, password);
          } else {
            logger.info('Connecting without password authentication');
            await this.obs.connect(url);
          }
          
          logger.info('Successfully connected to OBS');
          this.updateStatus('connected');
          
          // Save the last successful connection settings
          this.lastConnectionSettings = settings;
          this.reconnectAttempts = 0;
          
          // Start connection check
          this.startConnectionCheck();
        } catch (error: unknown) {
          // Check if this is an auth error
          const err = error as any;
          if (err.code === 4009) {
            logger.error('Authentication failed - incorrect password');
            throw new Error('Authentication failed - incorrect password');
          } else if (err.code === 4008) {
            logger.error('Authentication required but no password provided');
            throw new Error('Authentication required but no password provided');
          } else {
            logger.error('OBS connection error:', err);
            throw new Error(`Failed to connect to OBS: ${err.message || 'Unknown error'}`);
          }
        }
      } else if (this.lastConnectionSettings) {
        // Try to reconnect with last known settings
        return this.connect(this.lastConnectionSettings);
      } else {
        logger.error('No connection settings provided and no previous settings available');
        throw new Error('No connection settings provided');
      }
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Failed to connect to OBS:', err);
      this.lastError = err.message;
      this.updateStatus('error');
      throw error;
    }
  }

  private updateStatus(status: 'disconnected' | 'connected' | 'connecting' | 'error') {
    this.connectionStatus = status;
    this.broadcastStatus();
  }

  public getStatus() {
    return {
      status: this.connectionStatus,
      ...(this.lastError && { error: this.lastError })
    };
  }

  public async disconnect() {
    try {
      this.stopConnectionCheck();
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      
      if (this.obs) {
        logger.info('Disconnecting from OBS WebSocket');
        await this.obs.disconnect();
        this.updateStatus('disconnected');
      }
    } catch (error) {
      logger.error('Error disconnecting from OBS:', error);
    }
  }

  public getObs() {
    return this.obs;
  }

  public cleanup() {
    this.stopConnectionCheck();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.disconnect();
    logger.info('OBS WebSocket service cleaned up');
  }
}
