# Public API

This is the contract the WhatsApp patient bot integrates against, replacing its dummy data.
All routes live under `/api/public/`. All times are returned as human-readable clock labels
(e.g. `"9:00 AM"`), not raw numbers. All POST bodies are JSON.

On any domain error (an illegal request — a slot already taken, an appointment that doesn't
exist, etc.) every route responds `400 { "error": "<message>" }` with the message straight from
the engine's typed error. A missing resource responds `404 { "error": "..." }`.

---

## `GET /api/public/doctors`

Every doctor, with their current average wait time and which weekdays they see patients.

```bash
curl http://localhost:3000/api/public/doctors
```

```json
[
  { "id": "sharma", "name": "Dr. Sharma", "specialty": "General Physician", "room": "Room 1",
    "consultationFee": 300, "avgWaitMinutes": 20, "availableDays": ["MON","TUE","WED","THU","FRI","SAT"] },
  { "id": "iyer", "name": "Dr. Iyer", "specialty": "Cardiologist", "room": "Room 2",
    "consultationFee": 600, "avgWaitMinutes": 20, "availableDays": ["MON","WED","FRI"] },
  { "id": "khan", "name": "Dr. Khan", "specialty": "Dermatologist", "room": "Room 3",
    "consultationFee": 410, "avgWaitMinutes": 20, "availableDays": ["MON","TUE","WED","THU","FRI","SAT"] }
]
```

---

## `GET /api/public/availability?doctorId=&date=`

Bookable slots for one doctor on one date (`YYYY-MM-DD`). Only `OPEN` and `RELEASED` slots are
returned — a `PROTECTED` slot is the walk-in reserve and is never offered here. Querying a
future date materializes that day's session on demand, so patients can book ahead.

```bash
curl "http://localhost:3000/api/public/availability?doctorId=khan&date=2026-09-22"
```

```json
{ "date": "2026-09-22", "slots": [
  { "id": "session-3-slot-0", "time": 29834460, "label": "9:00 AM" },
  { "id": "session-3-slot-2", "time": 29834500, "label": "9:40 AM" }
] }
```

---

## `POST /api/public/book`

```bash
curl -X POST http://localhost:3000/api/public/book \
  -H "Content-Type: application/json" \
  -d '{"doctorId":"sharma","slotId":"session-1-slot-0","name":"Aniket","phone":"9998887777","reason":"checkup"}'
```

```json
{ "tokenNumber": 1, "appointmentId": "appt-1", "doctorName": "Dr. Sharma",
  "slotLabel": "9:00 AM", "likelyOpdTime": "9:00 AM", "consultationFee": 300 }
```

An existing patient is matched by phone number; a new one is registered automatically. Booking
starts as `PAY_AT_CLINIC` — call `/pay` to switch to prepaid.

---

## `POST /api/public/pay`

```bash
curl -X POST http://localhost:3000/api/public/pay -H "Content-Type: application/json" -d '{"tokenNumber":1}'
```

```json
{ "paymentStatus": "PREPAID" }
```

Prepaying skips the billing counter only — it never changes clinical queue position.

---

## `POST /api/public/cancel`

```bash
curl -X POST http://localhost:3000/api/public/cancel -H "Content-Type: application/json" -d '{"tokenNumber":1}'
```

```json
{ "ok": true }
```

A token number is only unique **within one clinic day**, so `/pay`, `/cancel` and
`/reschedule` all also accept `"appointmentId"` — the id `POST /api/public/book` returns. The
logged-in patient UI sends the id; a bot that only holds a token number can keep sending that.

---

## `POST /api/public/reschedule`

```bash
curl -X POST http://localhost:3000/api/public/reschedule \
  -H "Content-Type: application/json" -d '{"tokenNumber":1,"slotId":"session-1-slot-2"}'
```

```json
{ "tokenNumber": 1, "slotLabel": "9:40 AM", "likelyOpdTime": "9:40 AM" }
```

---

## `GET /api/public/appointment/:tokenNumber`

```bash
curl http://localhost:3000/api/public/appointment/1
```

```json
{ "status": "BOOKED", "doctorName": "Dr. Sharma", "slotLabel": "9:00 AM",
  "likelyOpdTime": "9:00 AM", "patientsAhead": 0, "paymentStatus": "PAY_AT_CLINIC" }
```

Before check-in, `likelyOpdTime` is the slot time plus the doctor's current running delay.
Once checked in, it's the live queue-based estimate.

---

## `GET /api/public/notifications/:tokenNumber?since=<ts>`

The bot polls this and sends each message it hasn't shown yet (pass the last `ts` it saw as
`since`; omit it, or pass `0`, to get the full history).

```bash
curl "http://localhost:3000/api/public/notifications/1?since=0"
```

```json
[
  { "ts": 29834940, "kind": "opd_time_changed", "message": "The doctor is running late. Your updated likely OPD time is 10:05 AM." },
  { "ts": 29835180, "kind": "approaching_queue", "message": "You are approaching the queue. There are 4 patients ahead of you. Please be ready." }
]
```

A token number is only unique within one clinic day, so the token-only form can also match an
older booking that held the same token. Pass the `appointmentId` returned by
`POST /api/public/book` to pin the feed to exactly one booking:

```bash
curl "http://localhost:3000/api/public/notifications/1?since=0&appointmentId=appt-1"
```

---

## `GET /api/patient/notifications?since=<ts>`

The signed-in patient's own updates — the same three kinds as above. Scoped to the session's
patient, so it can never show anyone else's, or an older booking that reused the token number.
Each row carries the booking it belongs to (`appointmentId` for a booking, `visitId` for a
walk-in), which is what the patient area groups by.

```bash
curl -b cookies.txt "http://localhost:3000/api/patient/notifications?since=0"
```

```json
{ "notifications": [
  { "ts": 29835180, "kind": "approaching_queue", "appointmentId": "appt-1", "visitId": "visit-1", "message": "You are approaching the queue. There are 4 patients ahead of you. Please be ready." }
] }
```

---

## `GET /api/public/triage?symptom=`

Deterministic keyword routing — no LLM.

```bash
curl "http://localhost:3000/api/public/triage?symptom=my+skin+is+itchy"
```

```json
{ "specialty": "Dermatologist", "suggestedDoctorId": "khan", "rationale": "Skin and hair concerns are seen by a dermatologist." }
```
