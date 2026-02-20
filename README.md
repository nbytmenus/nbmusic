# NBMusic

Spotify-like music streaming web app where you can:

- Register/login with persistent JSON file-backed accounts and tracks
- Stream uploaded audio with HTTP byte-range support
- Use an admin-only dev panel gated by a second admin panel password
- Upload tracks and play them in a polished dark UI

## Quick start

```bash
ADMIN_PASSWORD=admin123 ADMIN_PANEL_PASSWORD=devpanel123 node server.js
```

Open http://localhost:3000

Default admin user:
- username: `admin`
- password: from `ADMIN_PASSWORD` (default `admin123`)

## Environment variables

- `PORT` (default `3000`)
- `ADMIN_USERNAME` (default `admin`)
- `ADMIN_PASSWORD` (default `admin123`)
- `ADMIN_PANEL_PASSWORD` (default `changeme-dev-password`)
