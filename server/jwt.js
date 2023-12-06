const jwt = require('jsonwebtoken');

// Create a JWT token with user data
const generateToken = (userData) => {
  const token = jwt.sign(userData, '1234', { expiresIn: '1h' });
  return token;
};

// Verify and decode a JWT token
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, '1234');
    return decoded;
  } catch (error) {
    return null; // Invalid token
  }
};

module.exports = { generateToken, verifyToken };
