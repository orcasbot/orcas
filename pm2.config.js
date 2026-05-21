module.exports = {
  apps: [{
    name: 'orcas',
    script: 'src/index.js',
    instances: 1, // single instance (Telegram bot can't cluster)
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
    },
    exp_backoff_restart_delay: 1000,
    max_restarts: 10,
    min_uptime: '10s',
    // Log handling
    error_file: 'logs/error.log',
    out_file: 'logs/app.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
