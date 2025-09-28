// Minimal JWT helpers for backend-only bundle
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || '1234';
exports.generateToken = (userData) => jwt.sign(userData, SECRET, { expiresIn: '1h' });
exports.verifyToken = (token) => { try{ return jwt.verify(token, SECRET); }catch{ return null; } };
