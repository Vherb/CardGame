// Start CRA with unified WS flag set, independent of shell
process.env.REACT_APP_UNIFIED_WS = process.env.REACT_APP_UNIFIED_WS || '1';
require('child_process').spawn(/^win/.test(process.platform)? 'npm.cmd':'npm', ['start'], {
  stdio: 'inherit',
  shell: false,
  env: process.env
});
