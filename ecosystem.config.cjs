module.exports = {
  apps: [{
    name: 'sevenleads',
    script: 'server.js',
    node_args: '--experimental-vm-modules',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
