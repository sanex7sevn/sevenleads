import fs from 'fs';
import path from 'path';
import pino from 'pino';

const rootDir = process.env.SEVENLEADS_DIR || process.cwd();
const logDir = path.join(process.env.SEVENLEADS_DATA_DIR || path.join(rootDir, 'data'), 'logs');
fs.mkdirSync(logDir, { recursive: true });

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'password', 'token', 'authorization', 'req.headers.authorization',
      'body.password', 'body.email', 'body.phone', 'body.message'
    ],
    censor: '[removido]'
  }
}, pino.destination({ dest: path.join(logDir, 'sevenleads.log'), sync: false }));

export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id || null
    }, 'request');
  });
  next();
}

export default logger;
