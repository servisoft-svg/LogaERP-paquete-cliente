const path = require('path');

module.exports = {
  apps: [
    {
      name: 'loga-backend',
      cwd: path.join(__dirname, 'backend'),
      script: path.join(__dirname, 'backend', 'node_modules', '.bin', 'tsx'),
      args: 'src/index.ts',
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      max_restarts: 10,
      restart_delay: 2000,
      error_file: path.join(__dirname, 'logs', 'backend-error.log'),
      out_file: path.join(__dirname, 'logs', 'backend-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
