const path = require('path');
const logsDir = path.join(__dirname, 'logs');

module.exports = {
  apps: [
    {
      name: 'assistant',
      script: 'bun',
      args: 'run src/main.ts',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      output: path.join(logsDir, 'assistant-out.log'),
      error: path.join(logsDir, 'assistant-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'viewer-api',
      script: 'bun',
      args: 'run clients/heartbeat-viewer/server.ts',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      output: path.join(logsDir, 'viewer-api-out.log'),
      error: path.join(logsDir, 'viewer-api-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'viewer',
      script: 'bunx',
      args: 'vite --config clients/heartbeat-viewer/vite.config.ts',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      output: path.join(logsDir, 'viewer-out.log'),
      error: path.join(logsDir, 'viewer-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
