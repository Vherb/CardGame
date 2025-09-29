<?php
// Minimal Atspace DB API for NeonGames
// Upload to the web root of neongames.atspace.cc (e.g., /index.php) along with config.php
// SECURITY: keep API_KEY secret and restrict origins.

declare(strict_types=1);
header('Content-Type: application/json');

// Load config
$configPath = __DIR__ . '/config.php';
if (!file_exists($configPath)) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'error' => 'Missing config.php. Copy config.example.php -> config.php']);
  exit;
}
require_once $configPath;

// Basic CORS
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (!empty($origin) && isset($ALLOWED_ORIGINS) && is_array($ALLOWED_ORIGINS) && in_array($origin, $ALLOWED_ORIGINS, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
  header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// Auth via static API key header
function require_api_key(): void {
  $hdr = $_SERVER['HTTP_X_API_KEY'] ?? '';
  if (!defined('API_KEY') || API_KEY === 'CHANGE_ME_LONG_RANDOM_STRING' || !$hdr || !hash_equals(API_KEY, $hdr)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
    exit;
  }
}

// Simple rate limit per IP (very basic file-based token bucket)
function rate_limit_check(): void {
  if (!defined('RATE_LIMIT_PER_MINUTE') || RATE_LIMIT_PER_MINUTE <= 0) return;
  $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
  $bucket = sys_get_temp_dir() . '/rl_' . md5($ip);
  $now = time();
  $data = ['t' => $now, 'c' => 0];
  if (file_exists($bucket)) {
    $raw = @file_get_contents($bucket);
    if ($raw) { $data = json_decode($raw, true) ?: $data; }
  }
  if ($now - ($data['t'] ?? 0) >= 60) { $data = ['t' => $now, 'c' => 0]; }
  $data['c'] = ($data['c'] ?? 0) + 1;
  if ($data['c'] > RATE_LIMIT_PER_MINUTE) {
    http_response_code(429);
    echo json_encode(['ok' => false, 'error' => 'Rate limit exceeded']);
    exit;
  }
  @file_put_contents($bucket, json_encode($data));
}

rate_limit_check();

// Connect DB (mysqli)
$mysqli = @new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($mysqli->connect_errno) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'error' => 'DB connect failed']);
  exit;
}
$mysqli->set_charset('utf8mb4');

// Helpers
function json_input(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return (is_array($j)) ? $j : [];
}

function ok($data = []) { echo json_encode(['ok' => true] + $data); }
function bad($msg, $code = 400) { http_response_code($code); echo json_encode(['ok' => false, 'error' => $msg]); }

// Routing
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

if ($path === '/' || $path === '/ping') {
  ok(['service' => 'neongames-db-api']);
  exit;
}

// Protected endpoints require API key
require_api_key();

if ($path === '/registration' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $b = json_input();
  $email = trim($b['email'] ?? '');
  $username = trim($b['username'] ?? '');
  $password = (string)($b['password'] ?? '');
  if ($email === '' || $username === '' || $password === '') return bad('Missing fields', 400);

  // Check existing
  $stmt = $mysqli->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
  $stmt->bind_param('s', $username);
  $stmt->execute();
  $res = $stmt->get_result();
  if ($res && $res->num_rows > 0) return bad('Username already exists', 400);
  $stmt->close();

  // Hash password using PHP password_hash (bcrypt)
  $hashed = password_hash($password, PASSWORD_BCRYPT);
  $zero = 0.0;
  $stmt = $mysqli->prepare('INSERT INTO users (email, username, password, sc_balance) VALUES (?, ?, ?, ?)');
  $stmt->bind_param('sssd', $email, $username, $hashed, $zero);
  if (!$stmt->execute()) return bad('Registration failed', 500);
  $userId = $mysqli->insert_id;
  ok(['userId' => $userId, 'username' => $username, 'email' => $email]);
  exit;
}

if ($path === '/login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $b = json_input();
  $username = trim($b['username'] ?? '');
  $password = (string)($b['password'] ?? '');
  if ($username === '' || $password === '') return bad('Missing fields', 400);

  $stmt = $mysqli->prepare('SELECT id, email, password FROM users WHERE username = ? LIMIT 1');
  $stmt->bind_param('s', $username);
  $stmt->execute();
  $res = $stmt->get_result();
  if (!$res || $res->num_rows === 0) return bad('User not found', 404);
  $row = $res->fetch_assoc();
  if (!password_verify($password, $row['password'])) return bad('Incorrect password', 400);
  ok(['userId' => (int)$row['id'], 'username' => $username, 'email' => $row['email']]);
  exit;
}

if ($path === '/me' && $_SERVER['REQUEST_METHOD'] === 'GET') {
  $username = trim($_GET['username'] ?? '');
  if ($username === '') return bad('Missing username', 400);
  $stmt = $mysqli->prepare('SELECT id, username, email, sc_balance, public_key, xrp_address, eth_address, xrp_balance, eth_balance, xlm_balance FROM users WHERE username = ? LIMIT 1');
  $stmt->bind_param('s', $username);
  $stmt->execute();
  $res = $stmt->get_result();
  if (!$res || $res->num_rows === 0) return bad('User not found', 404);
  $u = $res->fetch_assoc();
  $u['sc_balance'] = (float)$u['sc_balance'];
  $u['xrp_balance'] = (float)$u['xrp_balance'];
  $u['eth_balance'] = (float)$u['eth_balance'];
  $u['xlm_balance'] = (float)$u['xlm_balance'];
  ok(['user' => $u]);
  exit;
}

if ($path === '/balance/update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $b = json_input();
  $username = trim($b['username'] ?? '');
  $column = trim($b['column'] ?? ''); // sc_balance | xlm_balance | xrp_balance | eth_balance
  $delta = (float)($b['delta'] ?? 0);
  if ($username === '' || $column === '' || !in_array($column, ['sc_balance','xlm_balance','xrp_balance','eth_balance'], true)) return bad('Invalid params', 400);
  $sql = 'UPDATE users SET ' . $column . ' = ' . $column . ' + ? WHERE username = ?';
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param('ds', $delta, $username);
  if (!$stmt->execute() || $stmt->affected_rows === 0) return bad('Update failed', 500);
  ok();
  exit;
}

// Default 404
http_response_code(404);
echo json_encode(['ok' => false, 'error' => 'Not found']);
