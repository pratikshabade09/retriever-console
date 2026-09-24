# Retriever Console

A real-time clinic operations system. Patients book from the public homepage with no login;
reception, doctor and admin staff each sign in with their own account and work from a
role-locked surface, all backed by one event-sourced engine so a booking made by a patient is
immediately visible to reception, and a consultation started by a doctor is immediately
reflected in admin's numbers.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the public hospital homepage. Patients book
from [/patient](http://localhost:3000/patient) after signing in at
[/patient/login](http://localhost:3000/patient/login); staff sign in at
[http://localhost:3000/login](http://localhost:3000/login), or self-register at
[/register](http://localhost:3000/register) as Reception or Admin. Doctors are not self-signed:
an admin adds a doctor (and their login) from the admin panel.

### Prototype logins

Both login pages carry a **Prototype · demo logins** panel: one click signs you straight in, no
registration needed. The accounts are created on demand (see `lib/server/demoAccounts.ts`) and
all share the password `demo1234`:

| Login | Role |
|---|---|
| `reception@demo.clinic` | Reception |
| `admin@demo.clinic` | Admin |
| `doctor@demo.clinic` | Doctor — Dr. Sharma |
| `patient@demo.clinic` | Patient — Anita Rao, with one past visit and one upcoming booking |

Nothing about them is special to the auth systems: they are ordinary accounts logging in through
the ordinary routes. Delete `lib/server/demoSeed.ts`, `lib/server/demoAccounts.ts`, the
`app/api/demo/accounts` route, `components/DemoLogins.tsx` and the two `<DemoLogins />` usages to
take the whole thing out.

State lives in one SQLite file at `data/clinic.db`, created on first run. Delete it (with the
server stopped) to start over — a brand-new file gets the demo patient's small history
(`lib/server/demoSeed.ts`) and the demo accounts again.

## What's here

- **Homepage** (`/`) — hospital information and doctor showcase. No auth, no booking UI.
- **Patient booking** (`/patient`) — after patient sign-in: book by doctor or by symptom triage,
  pay ahead or at the clinic, and see every appointment you've held. Tracking a single booking by
  its token number, no login, is at `/track`.
- **Reception** (`/reception`) — the front-desk console: live queue, walk-ins, bookings,
  billing, capacity, alerts.
- **Doctor** (`/doctor`) — the current patient, the queue, investigations, session controls.
- **Admin** (`/admin`) — the proof panel (are the system's core guarantees actually holding
  right now), measured outcomes, adding doctors, session/fee/policy configuration, and the audit
  logs.

The system runs on real time — there's no simulated clock to advance. `CLAUDE.md` has the full
architectural rule and the invariants it enforces; `API.md` documents the public booking API.

## Tests

```bash
npm test
```

Includes the engine's unit tests and a six-seed soak test that runs a full simulated clinic
day through the engine directly (dev tooling only — not how the live app gets its data).
