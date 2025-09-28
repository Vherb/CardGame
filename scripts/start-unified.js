// Start API server in unified mode without relying on shell env syntax
process.env.UNIFIED_WS = process.env.UNIFIED_WS || '1';
process.env.API_PORT = process.env.API_PORT || '3002';
require('../server/server.js');
