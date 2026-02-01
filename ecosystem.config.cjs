const path = require('path');
const logsDir = path.join(__dirname, 'logs');

module.exports = {
  apps: [
    {
      name: 'assistant',
      script: 'bun',
      args: 'run src/main.ts',
      autorestart: true,
      watch: false,
      output: path.join(logsDir, 'assistant-out.log'),
      error: path.join(logsDir, 'assistant-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
