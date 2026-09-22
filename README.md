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

Open [http://localhost:3000](http://localhost:3000) — that's the patient booking page. Staff
sign in at [http://localhost:3000/login](http://localhost:3000/login), or create an account at
[/register](http://localhost:3000/register) (pick a role; a Doctor account is bound to one of
the seeded doctors — Dr. Sharma, Dr. Iyer or Dr. Khan — at registration).

State lives in one SQLite file at `data/clinic.db`, created on first run. Delete it (with the
server stopped) to start over with an empty clinic and no accounts.

## What's here

- **Patient booking** (`/`) — no login. Book an appointment (by doctor or by symptom triage),
  pay ahead or at the clinic, and track a booking by its token number.
- **Reception** (`/reception`) — the front-desk console: live queue, walk-ins, bookings,
  billing, capacity, alerts.
- **Doctor** (`/doctor`) — the current patient, the queue, investigations, session controls.
- **Admin** (`/admin`) — the proof panel (are the system's core guarantees actually holding
  right now), measured outcomes, session/fee/policy configuration, and the audit logs.

The system runs on real time — there's no simulated clock to advance. `CLAUDE.md` has the full
architectural rule and the invariants it enforces; `API.md` documents the public booking API.

## Tests

```bash
npm test
```

Includes the engine's unit tests and a six-seed soak test that runs a full simulated clinic
day through the engine directly (dev tooling only — not how the live app gets its data).
