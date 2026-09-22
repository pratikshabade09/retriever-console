# Retriever Console

A real-time clinic operations system. The homepage is a public hospital marketing page; both
patients and staff sign in with their own account before doing anything — two completely
separate auth systems (see below), never a shared login form. Runs on real wall-clock time —
see "What changed from the original spec" below.

## The one architectural rule

```
command → authorize → decide(command, state, now) → Event[] → append → reduce → project → UI
```

There is exactly one mutation path. No API route sets a field directly. No component mutates
anything. The scheduler (a real `setInterval` in `lib/server/world.ts`) only *emits commands* —
it never touches state itself.

- `lib/engine/` — pure domain. Imports NOTHING: no React, no `next/*`, no Node builtins, no
  `fetch`. Everything here is a pure function of its arguments.
- `lib/server/` — event store, command dispatcher, the live world (real time), and **two
  independent auth systems**: staff (`authStore.ts` / `session.ts` / `requireUser.ts`, cookie
  `rc_session`) and patient (`patientAuthStore.ts` / `patientSession.ts` / `requirePatient.ts`,
  cookie `rc_patient_session`). This is where `Date.now()`, SQLite, `node:crypto`, and I/O are
  allowed to live.
- `app/api/` — HTTP boundary. Validates with zod, resolves the actor, dispatches a command.
  `app/api/public/*` is the token/phone-based contract a bot could also use (no login);
  `app/api/patient/*` and `app/api/auth/*` are the two account systems' own routes.
- `app/page.tsx` — the public marketing homepage (hospital info, doctor showcase). No auth,
  no booking UI directly — every booking-related link points into `/patient`.
- `app/patient/login/`, `app/patient/register/` — patient auth, public.
- `app/login/`, `app/register/` — staff auth, public.
- `app/patient/` — the logged-in patient area (book, view "my appointments"). Server component
  `page.tsx` calls `requirePatient()`, which redirects to `/patient/login` if unauthenticated,
  then renders `PatientClient.tsx`.
- `app/track/` — public, no login: look up a single appointment by token number. Exists for
  patients booked directly by reception who never created an account.
- `app/reception/`, `app/doctor/`, `app/admin/` — the three staff surfaces. Each is a server
  component (`page.tsx`) that calls `requireUser(role)` — which redirects to `/login` if
  unauthenticated, or to the caller's own role's surface on a role mismatch — then renders a
  `*Client.tsx` client component. A client component can never gate itself (the guard has to
  run before anything ships to the browser), so don't skip the server half of this split. The
  same pattern applies to `app/patient/` with `requirePatient()`.
- `components/` — shared presentational pieces only. No domain logic, no fetching.

Dependency direction is one-way: `app → lib/server → lib/engine`. Never the reverse.

A patient account is bound to one engine `Patient.id` at registration (`registerPatientAccount`
in `patientAuthStore.ts` dispatches `RegisterPatient` itself) — same pattern as a `DOCTOR` staff
account being bound to one `doctorId`. There is still exactly one way a Patient enters the
system: the `RegisterPatient` command, whether triggered by patient self-registration, a public
`/api/public/book` call, or reception typing a walk-in's name in.

## What changed from the original spec

The original spec (see git history / prior sessions) built this as a simulated-clock demo:
play/pause/speed/step controls, a seeded autopilot for canned demo data, no authentication.
The product direction changed to "the actual thing, not a demo":

- **No simulated clock.** `lib/server/world.ts`'s `nowInAbsoluteMinutes()` derives `now` from
  real `Date`, converted through the engine's local-calendar convention (`dateToAbsoluteMinutes`
  in `lib/engine/time.ts`) so it lines up with how slot times are generated. There is no
  play/pause/speed/step UI and no `/api/clock` route — the scheduler just runs
  (`setInterval` in `world.ts`, started at module load).
- **Real accounts.** `users`/`sessions` tables live in the same SQLite file as the event log
  (`lib/server/authStore.ts`), passwords hashed with Node's built-in `scrypt`. A `DOCTOR`
  account is bound to one seeded doctor id at registration (`/register`) — the doctor surface
  has no "pretend to be any doctor" selector anymore, it just uses `user.doctorId`.
- **Patient accounts, homepage is marketing-only.** `app/page.tsx` is a public hospital
  landing page (no booking UI on it directly). Booking (welcome → symptom triage or doctor
  list → date/slot picker → booking form → confirmation → pay-now-or-later) and "my
  appointments" live at `/patient`, gated by `requirePatient()`. It's built on the same
  `/api/public/*` routes the original spec designed for a WhatsApp bot — a patient account's
  name/phone are just passed straight through to `/api/public/book` instead of being re-typed.
- The seeded autopilot (`lib/server/autopilot.ts`) and the six-seed soak test
  (`lib/server/__tests__/soak.test.ts`) are still here — they're dev-only test tooling, never
  wired to a live route, and they still matter for proving the engine's invariants hold over a
  full simulated day. They are not how the live product gets its data anymore.

## Hard constraints (and where they're enforced)

- **No `Date.now()` in `lib/engine`.** Time enters only as a `now: number` argument threaded
  through `decide()`. Enforced by convention + `grep -rn "Date.now" lib/engine` must be empty.
  The real clock lives in `lib/server/world.ts`'s `nowInAbsoluteMinutes()`.
- **No `Math.random()` anywhere.** IDs derive from an aggregate version counter
  (`lib/engine/ids.ts`). Simulated variation (walk-in timing, consult-duration jitter) is a
  pure hash of `(seed, stableKey)` — see `lib/engine/hash.ts`. Same seed replays an identical
  day. `grep -rn "Math.random" lib components app` must be empty.
- **No mock data arrays in components.** If a patient/appointment/etc. exists in the UI, a
  command created it via the event log. `grep -rni "mock\|dummy"` must be empty outside specs.
- **No `useState` holding domain data.** Form-field state is fine; a list of appointments,
  queue entries, etc. must come from a server read (event-sourced projection), never local
  component state.
- **Derived values are derived on every read, never stored.** Queue position and likely OPD
  time are the two that matter most — see `lib/engine/queue.ts` and `lib/engine/opd.ts`.
  Neither is ever written to an event or a DB column.
- **`decide()` throws typed domain errors** (`lib/engine/errors.ts`). API routes and UI surface
  the message; nothing swallows or catches-and-ignores it.
- **`BOOKED → PROTECTED` is a forbidden slot transition.** The reducer (`lib/engine/reducer.ts`)
  refuses it even if an event asks for it — this is the system's central guarantee that
  capacity optimisation never displaces an existing booking. See test
  `reducer.test.ts` for the assertion.
- **`reclaimMargin < releaseMargin` strictly.** This gap is the capacity policy's hysteresis
  (`lib/engine/capacity.ts`). Equal margins oscillate release/reclaim forever.
- **Money never buys clinical priority.** Payment status has no field weight in queue
  ordering (`lib/engine/queue.ts`) — only `priorityTier`, `effectiveReadyTime`, `enteredAt`,
  then entry `id`.
- **A doctor running late can only push likely OPD time later**, never earlier. Only genuine
  freed-up capacity (cancellation/no-show) can move it earlier, and the notification must name
  the cause (`doctor_running_late | capacity_freed | queue_moved_faster`).

## Vocabulary (use exactly, everywhere — types, API fields, UI copy)

Token number, likely OPD time, patients ahead, average wait, consultation charges, prepaid /
pay in hospital. Do not invent synonyms ("ETA", "visit ID") for these patient-facing concepts.

## Verification commands

```
npm test                                   # vitest run — must be green
grep -rn "Math.random\|Date.now" lib/engine   # must return nothing
grep -rni "mock\|dummy\|TODO" lib components app  # must return nothing
```

## Recipe for adding a new command

1. Add the command type to `lib/engine/commands.ts`.
2. Add any new event type(s) it can produce to `lib/engine/events.ts` (past tense, carries the
   standard envelope: `type, ts, actorRole, actorId, aggregateType, aggregateId, v: 1`).
3. Add an authorization rule to `lib/server/authorize.ts` if the command isn't universally
   allowed — checked *before* `decide()` runs, never by hiding a UI button.
4. Implement the branch in `lib/engine/decide.ts`: validate against current state, throw a
   typed error (`lib/engine/errors.ts`) on an illegal request, otherwise return `Event[]`.
5. Extend `lib/engine/reducer.ts` to fold the new event(s) into state.
6. If the command should also affect derived values (likely OPD time, queue order, capacity
   ledger), check whether `lib/engine/opd.ts` / `queue.ts` / `capacity.ts` need to recompute in
   response — read section 5/6/7 of the spec before assuming they do.
7. Write a test in `lib/engine/__tests__/` first (TDD): the reducer test if it's about state
   shape, a `decide.test.ts` case if it's about business rules.
8. Wire the HTTP boundary only after the engine test is green: a route in `app/api/`, zod
   validation, actor resolution, dispatch. The route must never contain domain logic.
