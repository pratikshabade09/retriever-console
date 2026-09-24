# Deployment

## The constraint that shapes everything below

This app is **not** a serverless-function app. It needs:

1. **A persistent disk.** All state — the clinic's event log, staff accounts, patient
   accounts — lives in one SQLite file (`better-sqlite3`, a native, file-based, synchronous
   driver). If the filesystem it writes to is wiped between requests (as on most serverless
   platforms, including Vercel's default deployment), every write vanishes.
2. **A long-running Node process.** The clinic's real-time scheduler (`lib/server/world.ts`)
   is a `setInterval` that keeps running in the background for as long as the process is
   alive. A serverless function that spins up per-request and shuts down between calls never
   lets that interval do its job — no-show detection, capacity release/reclaim, and OPD-time
   notifications would silently stop firing.

**Use a platform that runs a persistent container with a persistent volume**: Railway,
Render, Fly.io, DigitalOcean App Platform, or a plain VPS running Docker. **Do not deploy this
to Vercel's default (serverless) target** — it will build, but bookings and accounts will not
survive past the first request, and the clock will stop mattering after a few dozen seconds.
Vercel's own persistent-container products would technically work, but the platforms below are
a more direct fit.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_PATH` | No | `./data/clinic.db` | Where the one SQLite file lives. Point this at your platform's persistent volume mount path. |
| `NODE_ENV` | Set by the platform normally | — | `production` turns on secure (`HTTPS`-only) auth cookies. Leaving this unset in production will still work over plain HTTP but is not recommended. |
| `PORT` | Usually set by the platform | `3000` | The Next.js standalone server reads this automatically. |

There are no API keys or secrets to configure — auth is self-contained (`node:crypto` password
hashing, cookie sessions), and the only external calls this app makes are to itself.

## Docker (works on Railway, Render, Fly.io, a VPS, or locally)

```bash
docker build -t retriever-console .
docker run -p 3000:3000 -v clinic-data:/app/data retriever-console
```

Or with Compose, which already wires up the persistent volume:

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

## Platform notes

**Railway / Render / Fly.io / DigitalOcean App Platform** — all four will build directly from
the `Dockerfile` if you point them at this repo. The one thing to configure on each is a
**persistent volume mounted at `/app/data`** (Railway: "Volumes"; Render: "Disks"; Fly.io:
`fly volumes create` + a `[mounts]` block in `fly.toml`; DigitalOcean: "App-Level Storage" or
switch to a Droplet). Without that volume, the container still runs, but a redeploy or restart
wipes every account and booking, because the SQLite file was living on ephemeral container
storage.

**A plain VPS** — install Docker, `git clone` this repo, `docker compose up -d --build`. Put a
reverse proxy (Caddy or nginx) in front for TLS; Caddy in particular needs close to zero
configuration for a single app + a domain name.

## First run in production

The database starts with the demo patient's small history and, once anyone opens a login page,
the four demo accounts listed in the README (`lib/server/demoSeed.ts` decides both). The three
initial doctors (Dr. Sharma, Dr. Iyer, Dr. Khan) and their schedules are configuration
(`lib/engine/seed.ts`), not something you need to create — and an admin can add more doctors at
runtime from `/admin`, which gives them the same default week and a fee. Everything else — every
real staff account, every patient account, every booking — gets created the first time someone
registers or books, exactly as it would running locally.

**Before this carries real data, remove the demo shortcuts**: the Prototype · demo logins panel
on both login pages (`components/DemoLogins.tsx`), the public `app/api/demo/accounts` route that
serves it working passwords, `lib/server/demoAccounts.ts`, and the `seedDemoHistoryIfEmpty` call
in `lib/server/world.ts` (plus `lib/server/demoSeed.ts` itself).

## Before you push to GitHub

`git status` should show `data/clinic.db` as ignored (already covered by `.gitignore`) — never
commit that file; it's local runtime state, not source, and would leak whatever test
accounts/bookings you created while developing.
