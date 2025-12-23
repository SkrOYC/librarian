/**
 * Logger utility for librarian CLI
 * Writes all logs to timestamped files in ~/.config/librarian/
 * Silent failure on write errors
 * Metadata-only logging (no sensitive data)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export type LogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'ERROR';
export type LogComponent = 'CLI' | 'CONFIG' | 'LIBRARIAN' | 'AGENT' | 'TOOL' | 'LLM' | 'GIT' | 'PATH' | 'LOGGER' | 'TIMING';

interface LogMetadata {
  [key: string]: any;
}

interface TimingOperation {
  operation: string;
  startTime: number;
}

class Logger {
  private static instance: Logger;
  private writeStream: fs.WriteStream | null = null;
  private debugMode: boolean = false;
  private timingOperations: Map<string, TimingOperation> = new Map();

  private constructor() {
    this.initializeLogFile();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /**
   * Initialize the log file with timestamp
   * Format: ~/.config/librarian/YYYY-MM-DD_HH-MM-SS_mmm-librarian.log
   */
  private initializeLogFile(): void {
    try {
      // Create timestamp for filename
      const now = new Date();
      const isoString = now.toISOString();

      if (!isoString) {
        throw new Error('Failed to generate timestamp');
      }

      // Create timestamp: YYYY-MM-DD_HH-MM-SS
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const ms = String(now.getMilliseconds()).padStart(3, '0');

      const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}_${ms}`;

      // Log directory
      const logDir = path.join(os.homedir(), '.config', 'librarian');

      // Ensure directory exists
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Log filename
      const logFilename = `${timestamp}-librarian.log`;
      const logPath = path.join(logDir, logFilename);

      // Create write stream
      this.writeStream = fs.createWriteStream(logPath, { flags: 'a' });

      // Handle stream errors silently
      this.writeStream.on('error', () => {
        // Silent - do nothing
      });

      // Log initialization
      this.info('LOGGER', `Logging initialized: ${logPath}`);

    } catch {
      // Silent - do nothing on initialization errors
    }
  }

  /**
   * Format timestamp: YYYY-MM-DD HH:MM:SS.mmm
   */
  private formatTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * Redact sensitive data from metadata
   */
  private redactMetadata(metadata: LogMetadata): LogMetadata {
    const redacted: LogMetadata = {};

    for (const [key, value] of Object.entries(metadata)) {
      // Redact sensitive keys
      if (['apiKey', 'token', 'secret', 'password'].includes(key.toLowerCase())) {
        redacted[key] = '[REDACTED]';
      } else if (key === 'query' && typeof value === 'string') {
        // Redact full query content, only log length
        redacted[`${key}Length`] = value.length;
      } else if (key === 'content' && typeof value === 'string') {
        // Redact full content, only log length
        redacted[`${key}Length`] = value.length;
      } else if ((key === 'repoUrl' || key === 'baseURL') && typeof value === 'string') {
        // Redact URLs, only show host
        try {
          const url = new URL(value);
          redacted[`${key}Host`] = url.hostname;
        } catch {
          redacted[key] = '[INVALID_URL]';
        }
      } else if (key === 'workingDir' && typeof value === 'string') {
        // Replace home directory with ~
        redacted[key] = value.replace(os.homedir(), '~');
      } else if (typeof value === 'string' && (value.includes(os.homedir()) || value.includes('/home/'))) {
        // Redact any path containing home directory
        redacted[key] = value.replace(os.homedir(), '~');
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  /**
   * Format log entry
   */
  private formatLogEntry(level: LogLevel, component: LogComponent, message: string, metadata?: LogMetadata): string {
    const timestamp = this.formatTimestamp();
    let entry = `[${timestamp}] [${level}] [${component}] ${message}`;

    if (metadata && Object.keys(metadata).length > 0) {
      const redactedMetadata = this.redactMetadata(metadata);
      entry += ` | ${JSON.stringify(redactedMetadata)}`;
    }

    return entry;
  }

  /**
   * Write log entry to file
   */
  private writeLog(entry: string): void {
    try {
      if (this.writeStream && !this.writeStream.destroyed) {
        this.writeStream.write(entry + '\n', (err) => {
          // Silent - do nothing on error
        });
      }
    } catch {
      // Silent - do nothing on write errors
    }
  }

  /**
   * Internal logging method
   */
  private log(level: LogLevel, component: LogComponent, message: string, metadata?: LogMetadata): void {
    try {
      const entry = this.formatLogEntry(level, component, message, metadata);
      this.writeLog(entry);
    } catch {
      // Silent - do nothing on log errors
    }
  }

  /**
   * INFO level - Always logged
   */
  info(component: LogComponent, message: string, metadata?: LogMetadata): void {
    this.log('INFO', component, message, metadata);
  }

  /**
   * DEBUG level - Only logged when debug mode is enabled
   */
  debug(component: LogComponent, message: string, metadata?: LogMetadata): void {
    if (this.debugMode) {
      this.log('DEBUG', component, message, metadata);
    }
  }

  /**
   * WARN level - Always logged
   */
  warn(component: LogComponent, message: string, metadata?: LogMetadata): void {
    this.log('WARN', component, message, metadata);
  }

  /**
   * ERROR level - Always logged with stack trace
   */
  error(component: LogComponent, message: string, error?: Error, metadata?: LogMetadata): void {
    const errorMetadata: LogMetadata = metadata ? { ...metadata } : {};

    if (error) {
      errorMetadata.errorName = error.name;
      errorMetadata.errorMessage = error.message;

      // Include stack trace in metadata
      if (error.stack) {
        errorMetadata.stack = error.stack;
      }
    }

    this.log('ERROR', component, message, errorMetadata);
  }

  /**
   * Start timing an operation
   * Returns an operation ID for later timingEnd call
   */
  timingStart(operation: string): string {
    const operationId = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timingOperations.set(operationId, {
      operation,
      startTime: performance.now()
    });

    this.debug('TIMING', `Started: ${operation}`);

    return operationId;
  }

  /**
   * End timing an operation
   */
  timingEnd(operationId: string, component: LogComponent, message?: string): void {
    const timing = this.timingOperations.get(operationId);

    if (timing) {
      const duration = performance.now() - timing.startTime;
      const durationMs = Math.round(duration);

      this.timingOperations.delete(operationId);

      const logMessage = message || `Completed: ${timing.operation}`;
      this.info(component, logMessage, { duration: `${durationMs}ms` });

      if (this.debugMode) {
        this.debug('TIMING', `Ended: ${timing.operation}`, { durationMs });
      }
    }
  }

  /**
   * Clean up resources
   */
  close(): void {
    try {
      if (this.writeStream && !this.writeStream.destroyed) {
        this.writeStream.end();
      }
    } catch {
      // Silent
    }
  }
}

// Export singleton instance
export const logger = Logger.getInstance();
