// Start API server in unified mode without relying on shell env syntax
process.env.UNIFIED_WS = process.env.UNIFIED_WS || '1';
// Prefer local .env when running unified locally; fall back to .env.production inside server if .env is missing
process.env.ENV_FILE = process.env.ENV_FILE || '.env';
// Load .env early so real values (like MYSQL_PASSWORD) are present before setting defaults below
try {
	const dotenv = require('dotenv');
	dotenv.config({ path: process.env.ENV_FILE });
} catch {}
// Ensure local dev defaults so DB behaves like before
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.MYSQL_DB = process.env.MYSQL_DB || 'game';
process.env.MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
process.env.MYSQL_PORT = process.env.MYSQL_PORT || '3306';
process.env.MYSQL_USER = process.env.MYSQL_USER || 'root';
// Only set an empty password if none was provided via env/.env
if (process.env.MYSQL_PASSWORD === undefined) process.env.MYSQL_PASSWORD = '';
// Disable SSL locally unless explicitly enabled
process.env.MYSQL_SSL = process.env.MYSQL_SSL || '0';
process.env.MYSQL_SSL_REJECT_UNAUTH = process.env.MYSQL_SSL_REJECT_UNAUTH || '0';
// Ensure DB calls use direct MySQL locally, not HTTP bridge
process.env.DB_OVER_HTTP = process.env.DB_OVER_HTTP || '0';
// Force the unified API to bind to 3002 locally so CRA can use 3000 without conflict
process.env.PORT = '3002';
process.env.API_PORT = process.env.API_PORT || '3002';
// For local development, allow the server to start even if DB is unreachable
process.env.DB_OPTIONAL = process.env.DB_OPTIONAL || '1';
require('../server/server.js');
