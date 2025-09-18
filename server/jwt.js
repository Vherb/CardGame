// server/jwt.js
const jwt = require("jsonwebtoken");

// ⚠️ In production, move the secret to an env var
const SECRET = process.env.JWT_SECRET || "1234";

const generateToken = (userData) => {
  return jwt.sign(userData, SECRET, { expiresIn: "1h" });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
};

module.exports = { generateToken, verifyToken };
