import winston from 'winston';

// Determine log level based on environment
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Create winston logger
export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
      let msg = `${timestamp} [${level}] ${message}`;

      // Add metadata if present
      const metaStr = Object.keys(metadata).length > 0
        ? JSON.stringify(metadata, null, 2)
        : '';

      return metaStr ? `${msg}\n${metaStr}` : msg;
    })
  ),
  transports: [
    new winston.transports.Console()
  ],
});

// Log the current log level on startup
logger.info(`Logger initialized with level: ${logLevel}`);
