import { pino } from 'pino';
import { config } from '../config.js';
import { redactPii } from '../security/redact.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  serializers: {
    req: (req: any) => {
      return {
        method: req.method,
        url: req.url,
        id: req.id,
      };
    },
    msg: (msg: string) => redactPii(msg)
  }
});
