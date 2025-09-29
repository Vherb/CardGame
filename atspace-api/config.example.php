<?php
// Copy this file to config.php and fill in your Atspace MySQL credentials.

// MySQL credentials (from Atspace panel)
const DB_HOST = 'localhost'; // likely localhost on Atspace
const DB_USER = '2290917_neongames';
const DB_PASS = 'REPLACE_ME';
const DB_NAME = '2290917_neongames';

// Simple shared API key to authenticate calls from your Render backend
// Generate a long random string and store the same value in Render env: ATSPACE_API_KEY
const API_KEY = 'CHANGE_ME_LONG_RANDOM_STRING';

// CORS: allow your Render service origin(s)
$ALLOWED_ORIGINS = [
  'https://your-render-service.onrender.com',
  'http://localhost:3000',
];

// Optional: rate limit (requests per minute per IP)
const RATE_LIMIT_PER_MINUTE = 120;
