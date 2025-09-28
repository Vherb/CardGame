// Start API server in unified mode without relying on shell env syntax
process.env.UNIFIED_WS = process.env.UNIFIED_WS || '1';
// Force the unified API to bind to 3002 locally so CRA can use 3000 without conflict
process.env.PORT = '3002';
process.env.API_PORT = process.env.API_PORT || '3002';
require('../server/server.js');
