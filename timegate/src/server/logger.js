import pino from 'pino';

// Configure Pino
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Redact sensitive fields automatically to prevent data leaks
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password'],
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
});

export default logger;