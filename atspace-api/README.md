# NeonGames Atspace DB API

A minimal PHP API you can upload to neongames.atspace.cc to expose a small set of DB operations over HTTPS. Use this when direct remote MySQL connections are blocked by your shared host.

## Files
- `index.php` — single entry with a tiny router for:
  - `GET /ping`
  - `POST /registration` (email, username, password)
  - `POST /login` (username, password)
  - `GET /me?username=...`
  - `POST /balance/update` (username, column, delta)
- `config.example.php` — copy to `config.php` and fill in your DB creds and API key.

## Setup on Atspace
1. In this folder, copy `config.example.php` to `config.php`.
2. Set:
   - `DB_HOST` (likely `localhost` on Atspace)
   - `DB_USER`, `DB_PASS`, `DB_NAME`
   - `API_KEY` — long random string
   - `$ALLOWED_ORIGINS` — include your Render service origin
3. Upload `index.php` and `config.php` to your Atspace site root (e.g., `/public_html`).
4. Test: open `https://neongames.atspace.cc/ping` in your browser; expect `{ ok: true, service: "neongames-db-api" }`.

## Configure your Render backend
Add these env vars to your Render service:
- `ATSPACE_API_URL=https://neongames.atspace.cc`
- `ATSPACE_API_KEY=the_same_key_from_config.php`
- `DB_OVER_HTTP=1` (optional flag we can use to switch code paths)

Then update the backend to call this HTTP API for DB actions instead of MySQL directly (I can wire this next if you want).

## Security
- Keep `config.php` out of your repo; upload it directly to Atspace.
- Use HTTPS only.
- Restrict `$ALLOWED_ORIGINS` to trusted origins.
- Consider adding per-endpoint input validations and logging.

## Notes
- This API uses `mysqli` with prepared statements and PHP password hashing.
- Rate limiting is a simple per-IP file token bucket; you can remove or replace it if Atspace disallows writing to `sys_get_temp_dir()`.