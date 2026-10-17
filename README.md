# SCB

A side-scrolling platformer in the spirit of the NES original, with 16-bit (SNES-style) graphics:
256×224 resolution, banded and dithered skies, parallax mountains and hills, shaded tiles.

- **Two levels**: 1-1 *Sunny Meadows* (overworld) and 1-2 *Crystal Caverns* (underground).
- **Same levels for everyone**: generated procedurally from fixed seeds in `web/js/config.js`.
- **Free scrolling**: you can walk back left; the camera follows both ways.
- **Save anywhere** (pause menu). Saves keep the exact state mid-level: position, enemies, broken blocks, items, timer.
  Each save goes to one of 3 slots in the browser and is synced to the server under a **save code**
  (e.g. `ABCD-EFGH`). Enter the code under *Load Game* on any device to continue there.
- Keyboard, gamepad and touch controls. All graphics and sound are generated in code, so there are no asset files.

## Run it on your Docker host

```sh
docker compose up -d --build
```

Then open `http://<docker-host>:8080`. Saves are stored in the `scb-data` volume (`/data/saves/*.json`).

Without compose:

```sh
docker build -t scb .
docker run -d --name scb -p 8080:8080 -v scb-data:/data --restart unless-stopped scb
```

The image is about 10 MB: a static Go binary on `scratch` that runs as a non-root user and has a built-in health check.
To serve it under HTTPS or a domain, put it behind your usual reverse proxy (Caddy, Traefik, nginx).
All URLs are relative, so it also works under a sub-path such as `/scb/`.

| Env var     | Default | Meaning                    |
|-------------|---------|----------------------------|
| `SCB_ADDR`  | `:8080` | Listen address             |
| `SCB_DATA`  | `/data` | Directory for save files   |

## Develop locally

```sh
go run .            # http://localhost:8080 (files are embedded at build time, so restart after edits)
npm test            # mechanics tests + a bot that plays every level to the flag
npm run levels      # print the generated levels as ASCII
```

`npm run test:browser` needs Playwright and a running server (`URL=http://localhost:8080/`).
Open the game with `#debug` in the URL to get `window.scb` for poking at the game state.

## Controls

| Action        | Keyboard                    | Gamepad      |
|---------------|-----------------------------|--------------|
| Move          | ← → / A D                   | D-pad, stick |
| Crouch        | ↓ / S                       | Down         |
| Jump          | Z, Space, K, ↑ / W          | A            |
| Run / fire    | X, Shift, J                 | X            |
| Pause / menu  | Esc, Enter, P               | Start        |
| Mute          | M                           |              |

## How it works

| File | What it does |
|------|--------------|
| `main.go` | Serves the embedded, pre-gzipped game files and the save API |
| `web/js/levelgen.js` | Deterministic level generator. It builds levels from chunks (block rows, pits, pipes, stairs, platforms) kept within the player's jump range |
| `web/js/entities.js` | Tile collision, player physics, enemies, items |
| `web/js/game.js` | Game states, scoring, level-end sequence, rendering, save serialisation |
| `web/js/art.js` | Pixel-art sprites, procedural tiles and parallax backgrounds |
| `web/js/audio.js` | WebAudio chiptune sound effects and music |
| `web/js/save.js`, `ui.js` | Save slots, server sync, menus |

**Adding a level:** add an entry to `LEVELS` in `web/js/config.js` (seed, width, theme, difficulty). Then run `npm test`
to confirm the bot can finish it. Changing a seed or the generator changes the levels. If you do, bump `GEN_VERSION`:
saves made on the old levels then load at the start of their level, keeping score and lives, instead of mid-level.

### Save API

| Method | Path | Body | Result |
|--------|------|------|--------|
| `POST` | `/api/saves` | `{"data": {...}}` | `{"code", "updatedAt"}`: new save code |
| `PUT`  | `/api/saves/{code}` | `{"data": {...}}` | Updates an existing code |
| `GET`  | `/api/saves/{code}` | | `{"code", "updatedAt", "data"}` |

There are no accounts: the save code is the key, so anyone holding a code can load or overwrite that save.
Saves are capped at 64 KB, and writes are limited to 30 per minute per IP.
When the same code is saved from two devices, the last write wins. Loading a slot uses the newer of the
local and server copies.
