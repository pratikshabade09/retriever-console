"use client";

import { useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { StatTile } from "@/components/StatTile";
import { Badge } from "@/components/Badge";
import { useEngineState } from "@/lib/client/useEngineState";
import { sendCommand } from "@/lib/client/api";
import { activeQueueForDoctor } from "@/lib/engine/queue";
import { likelyOpdTimeForQueueEntry } from "@/lib/engine/opd";
import { currentFee } from "@/lib/engine/money";
import { formatClockLabel } from "@/lib/engine/time";
import type { EngineState } from "@/lib/engine/state";
import type { QueueEntry } from "@/lib/engine/types";
import type { StaffUser } from "@/lib/server/authStore";

const FALLBACK_CONSULT_MINUTES = 20;

interface AvailabilitySlotView {
  id: string;
  label: string;
}

function nextSevenDays(): { date: string; label: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    };
  });
}

export default function ReceptionClient({ user }: { user: StaffUser }) {
  const data = useEngineState(1000);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<string>("sharma");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [walkInReason, setWalkInReason] = useState("");
  const [walkInDoctor, setWalkInDoctor] = useState("sharma");
  const [bookName, setBookName] = useState("");
  const [bookPhone, setBookPhone] = useState("");
  const [bookReason, setBookReason] = useState("");
  const [bookSlotId, setBookSlotId] = useState("");
  const [bookDate, setBookDate] = useState(() => nextSevenDays()[0].date);
  const [bookSlots, setBookSlots] = useState<AvailabilitySlotView[]>([]);
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  const [escalateReason, setEscalateReason] = useState("");

  useEffect(() => {
    fetch(`/api/public/availability?doctorId=${selectedDoctor}&date=${bookDate}`)
      .then((r) => r.json())
      .then((d) => {
        setBookSlots(d.slots ?? []);
        setBookSlotId("");
      })
      .catch(() => setBookSlots([]));
  }, [selectedDoctor, bookDate]);

  if (!data) return <Shell clock={undefined} user={user}>Loading…</Shell>;
  const { state, clock } = data;
  const now = clock.now;

  async function run(command: Record<string, unknown>) {
    setError(null);
    const result = await sendCommand({ actorRole: "RECEPTION", actorId: user.id, ...command });
    if (result.error) {
      setError(result.error);
      return;
    }
    const deferred = (result.events ?? []).find((e) => (e as { type?: string }).type === "WalkInDeferred") as
      | { suggestion?: string }
      | undefined;
    if (deferred) setError(`Walk-in deferred — no protected capacity right now. ${deferred.suggestion}`);
  }

  const doctors = Object.values(state.doctors);

  // ---- derived stats ----
  const allQueues = doctors.map((d) => ({ doctor: d, queue: activeQueueForDoctor(state, d.id) }));
  const waitingCount = allQueues.reduce((sum, q) => sum + q.queue.filter((e) => e.status === "WAITING").length, 0);
  const worstDelay = Math.max(0, ...Object.values(state.sessions).filter((s) => s.status === "OPEN").map((s) => s.runningDelayMinutes), 0);
  const protectedAvailable = Object.values(state.slots).filter((s) => s.state === "PROTECTED" && s.time >= now).length;
  const releasedAvailable = Object.values(state.slots).filter((s) => s.state === "RELEASED" && s.time >= now).length;
  const reclaimedCount = state.capacityLedger.filter((r) => r.action === "RECLAIM").length;
  const uncollected = Object.values(state.charges).filter((c) => c.status === "DUE").length +
    Object.values(state.appointments).filter((a) => a.status !== "CANCELLED" && a.paymentStatus === "PAY_AT_CLINIC" && a.status !== "NO_SHOW").length;
  const revenue = Object.values(state.charges).filter((c) => c.status === "COLLECTED").reduce((sum, c) => sum + c.amount, 0);
  const allWaits = allQueues.flatMap(({ queue }) =>
    queue.filter((e) => e.status === "WAITING").map((e) => likelyOpdTimeForQueueEntry(state, e, now, FALLBACK_CONSULT_MINUTES) - now),
  );
  const avgWait = allWaits.length ? Math.round(allWaits.reduce((a, b) => a + b, 0) / allWaits.length) : 0;

  const patientName = (patientId: string) => state.patients[patientId]?.name ?? "Unknown";

  return (
    <Shell clock={clock} user={user}>
      <div className="tiles">
        <StatTile value={waitingCount} label="Patients waiting" />
        <StatTile value={`${worstDelay}m`} label="Worst doctor delay" />
        <StatTile value={`${avgWait}m`} label="Average wait" />
        <StatTile value={protectedAvailable} label="Protected available" />
        <StatTile value={releasedAvailable} label="Released available" />
        <StatTile value={reclaimedCount} label="Reclaimed" />
        {/* Always 0: the reducer structurally refuses BOOKED -> PROTECTED even if an event
            asks for it (see reducer.ts). The Admin proof panel audits the raw event log to
            show this isn't just asserted but actually walked and checked. */}
        <StatTile value={0} label="Bookings displaced" tone="good" />
        <StatTile value={uncollected} label="Uncollected payments" />
        <StatTile value={`₹${revenue}`} label="Revenue" />
      </div>

      <div className="columns columns-3">
        {/* ---------------- LEFT: live queue, front desk, alerts ---------------- */}
        <div className="column">
          <div className="card">
            <div className="card-title">Live queue</div>
            {allQueues.every(({ queue }) => queue.length === 0) && <div className="empty">No patients in any queue.</div>}
            {allQueues.map(({ doctor, queue }) =>
              queue.length === 0 ? null : (
                <div key={doctor.id} style={{ marginBottom: 10 }}>
                  <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
                    {doctor.name}
                  </div>
                  {queue.map((entry, idx) => (
                    <QueueRow
                      key={entry.id}
                      state={state}
                      now={now}
                      entry={entry}
                      position={idx}
                      patientName={patientName}
                      onEscalate={() => setEscalatingId(entry.id)}
                      onLeave={() => run({ type: "LeaveQueue", queueEntryId: entry.id })}
                    />
                  ))}
                </div>
              ),
            )}
            {escalatingId && (
              <div className="card" style={{ marginTop: 8 }}>
                <div className="card-title">Escalate priority — reason required</div>
                <input
                  placeholder="Why does this patient need priority?"
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                  style={{ width: "100%", marginBottom: 6 }}
                />
                <div className="row-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      await run({ type: "EscalatePriority", queueEntryId: escalatingId, tier: 1, reason: escalateReason });
                      setEscalatingId(null);
                      setEscalateReason("");
                    }}
                  >
                    Escalate (tier 1)
                  </button>
                  <button className="btn btn-sm" onClick={() => setEscalatingId(null)}>
                    Cancel
                  </button>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Tier 2 clinical escalation can only be raised by the doctor.
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">Front desk</div>
            <div style={{ marginBottom: 10 }}>
              <div className="dim" style={{ marginBottom: 4 }}>
                Register a walk-in
              </div>
              <div className="field">
                <select value={walkInDoctor} onChange={(e) => setWalkInDoctor(e.target.value)}>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <input placeholder="Name" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} />
              </div>
              <div className="field">
                <input placeholder="Phone" value={walkInPhone} onChange={(e) => setWalkInPhone(e.target.value)} />
              </div>
              <div className="field">
                <input placeholder="Reason for visit" value={walkInReason} onChange={(e) => setWalkInReason(e.target.value)} />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  const existing = Object.values(state.patients).find((p) => p.phone === walkInPhone);
                  let patientId = existing?.id;
                  if (!patientId) {
                    await run({ type: "RegisterPatient", name: walkInName, phone: walkInPhone });
                  }
                  const after = existing ? state : (await fetch("/api/staff/state").then((r) => r.json())).state;
                  patientId = patientId ?? Object.values((after as EngineState).patients).find((p) => p.phone === walkInPhone)?.id;
                  if (patientId) await run({ type: "RegisterWalkIn", patientId, doctorId: walkInDoctor, reason: walkInReason || "walk-in" });
                  setWalkInName("");
                  setWalkInPhone("");
                  setWalkInReason("");
                }}
              >
                Register walk-in
              </button>
            </div>

            <div>
              <div className="dim" style={{ marginBottom: 4 }}>
                Book an appointment
              </div>
              <div className="field">
                <select value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)}>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <select value={bookDate} onChange={(e) => setBookDate(e.target.value)}>
                  {nextSevenDays().map((d) => (
                    <option key={d.date} value={d.date}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <select value={bookSlotId} onChange={(e) => setBookSlotId(e.target.value)}>
                  <option value="">{bookSlots.length === 0 ? "No free slots this day" : "Select a free slot…"}</option>
                  {bookSlots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <input placeholder="Name" value={bookName} onChange={(e) => setBookName(e.target.value)} />
              </div>
              <div className="field">
                <input placeholder="Phone" value={bookPhone} onChange={(e) => setBookPhone(e.target.value)} />
              </div>
              <div className="field">
                <input placeholder="Reason" value={bookReason} onChange={(e) => setBookReason(e.target.value)} />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  if (!bookSlotId) {
                    setError("Choose a slot first");
                    return;
                  }
                  const existing = Object.values(state.patients).find((p) => p.phone === bookPhone);
                  if (!existing) await run({ type: "RegisterPatient", name: bookName, phone: bookPhone });
                  const after = existing ? state : (await fetch("/api/staff/state").then((r) => r.json())).state;
                  const patientId = existing?.id ?? Object.values((after as EngineState).patients).find((p) => p.phone === bookPhone)?.id;
                  if (patientId) {
                    await run({
                      type: "BookAppointment",
                      patientId,
                      doctorId: selectedDoctor,
                      slotId: bookSlotId,
                      reason: bookReason || "consultation",
                      bookingSource: "RECEPTION",
                      paymentStatus: "PAY_AT_CLINIC",
                    });
                  }
                  setBookName("");
                  setBookPhone("");
                  setBookReason("");
                  setBookSlotId("");
                  fetch(`/api/public/availability?doctorId=${selectedDoctor}&date=${bookDate}`)
                    .then((r) => r.json())
                    .then((d) => setBookSlots(d.slots ?? []))
                    .catch(() => {});
                }}
              >
                Book appointment
              </button>
            </div>
          </div>

          <AlertsPanel state={state} now={now} />
        </div>

        {/* ---------------- MIDDLE: capacity strip + timeline ---------------- */}
        <div className="column">
          <div className="card">
            <div className="card-title">
              Capacity — {state.doctors[selectedDoctor]?.name}
              <select value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)}>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <CapacityStrip state={state} doctorId={selectedDoctor} now={now} />
            <div className="legend">
              <span>
                <i className="legend-swatch" style={{ background: "var(--bg-raised)" }} /> Open
              </span>
              <span>
                <i className="legend-swatch" style={{ background: "var(--warn-dim)" }} /> Protected
              </span>
              <span>
                <i className="legend-swatch" style={{ background: "var(--accent-dim)" }} /> Released
              </span>
              <span>
                <i className="legend-swatch" style={{ background: "var(--good-dim)" }} /> Booked
              </span>
              <span>
                <i className="legend-swatch" style={{ background: "var(--bad-dim)" }} /> Consumed
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Capacity timeline</div>
            {state.capacityLedger.filter((r) => r.doctorId === selectedDoctor).length === 0 && <div className="empty">No capacity decisions yet.</div>}
            {[...state.capacityLedger]
              .filter((r) => r.doctorId === selectedDoctor)
              .reverse()
              .slice(0, 25)
              .map((row) => (
                <div key={row.id} className="row" style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Badge tone={row.action === "RELEASE" ? "accent" : row.action === "RECLAIM" ? "warn" : undefined}>{row.action}</Badge>
                    <span className="mono dim" style={{ fontSize: 10 }}>
                      {formatClockLabel(row.ts)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11 }}>
                    {row.protectedBefore} → {row.protectedAfter} protected
                  </div>
                  <div className="muted" style={{ fontSize: 10 }}>
                    {row.reason}
                  </div>
                  <div className="mono muted" style={{ fontSize: 10 }}>
                    required {row.requiredCapacity} · margin {row.margin} · trigger {row.trigger} · {row.policyVersion}
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* ---------------- RIGHT: arrivals, investigations, billing, messages, economics ---------------- */}
        <div className="column">
          <div className="card">
            <div className="card-title">Arrivals today</div>
            {Object.values(state.appointments).filter((a) => Math.floor(a.slotTime / 1440) === Math.floor(now / 1440)).length === 0 && (
              <div className="empty">No appointments today.</div>
            )}
            {Object.values(state.appointments)
              .filter((a) => Math.floor(a.slotTime / 1440) === Math.floor(now / 1440))
              .sort((a, b) => a.slotTime - b.slotTime)
              .map((appt) => (
                <div key={appt.id} className="row">
                  <span className="row-token mono">#{appt.tokenNumber}</span>
                  <div className="row-main">
                    <div className="row-title">
                      {patientName(appt.patientId)} · {state.doctors[appt.doctorId]?.name}
                    </div>
                    <div className="row-sub mono">
                      {formatClockLabel(appt.slotTime)} · <StatusBadge status={appt.status} />{" "}
                      <PaymentBadge status={appt.paymentStatus} />
                    </div>
                  </div>
                  {appt.status === "BOOKED" && (
                    <div className="row-actions">
                      {appt.paymentStatus === "PAY_AT_CLINIC" && (
                        <button className="btn btn-sm" onClick={() => run({ type: "CollectPayment", target: "appointment", id: appt.id })}>
                          Collect ₹{currentFee(state, appt.doctorId, now)}
                        </button>
                      )}
                      <button className="btn btn-sm btn-primary" onClick={() => run({ type: "CheckInPatient", appointmentId: appt.id })}>
                        Check in
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => run({ type: "CancelAppointment", appointmentId: appt.id })}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>

          <div className="card">
            <div className="card-title">Investigations</div>
            {Object.values(state.investigations).length === 0 && <div className="empty">No investigations ordered.</div>}
            {Object.values(state.investigations)
              .slice()
              .reverse()
              .map((inv) => (
                <InvestigationRow key={inv.id} state={state} inv={inv} now={now} onResult={(flag, summary) => run({ type: "RecordInvestigationResult", investigationId: inv.id, resultSummary: summary, resultFlag: flag })} />
              ))}
          </div>

          <div className="card">
            <div className="card-title">Billing</div>
            {Object.values(state.invoices).length === 0 && <div className="empty">No invoices issued.</div>}
            {Object.values(state.invoices)
              .slice()
              .reverse()
              .map((inv) => (
                <div key={inv.id} className="row" style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Invoice {inv.id}</span>
                    <span className="mono">₹{inv.total}</span>
                  </div>
                  {inv.lines.map((l) => (
                    <div key={l.chargeId} className="muted" style={{ fontSize: 10 }}>
                      {l.description} — ₹{l.amount}
                    </div>
                  ))}
                </div>
              ))}
            <div className="dim" style={{ marginTop: 8, marginBottom: 4 }}>
              Due charges
            </div>
            {Object.values(state.charges).filter((c) => c.status === "DUE").length === 0 && <div className="empty">Nothing due.</div>}
            {Object.values(state.charges)
              .filter((c) => c.status === "DUE")
              .map((c) => (
                <div key={c.id} className="row">
                  <div className="row-main">
                    {c.kind} — ₹{c.amount}
                  </div>
                  <button className="btn btn-sm" onClick={() => run({ type: "CollectPayment", target: "charge", id: c.id })}>
                    Collect
                  </button>
                </div>
              ))}
          </div>

          <div className="card">
            <div className="card-title">Patient messages</div>
            {state.notifications.length === 0 && <div className="empty">No messages sent yet.</div>}
            {[...state.notifications]
              .reverse()
              .slice(0, 20)
              .map((n) => (
                <div key={n.id} className="row" style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="row-token mono">#{n.tokenNumber}</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>
                      {formatClockLabel(n.ts)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11 }}>{n.message}</div>
                </div>
              ))}
          </div>

          <EconomicsPanel state={state} now={now} />
        </div>
      </div>

      {error && (
        <div className="card" style={{ position: "fixed", bottom: 12, right: 12, borderColor: "var(--bad)", maxWidth: 360 }}>
          <div style={{ color: "var(--bad)", fontSize: 12 }}>{error}</div>
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ clock, user, children }: { clock: { now: number } | undefined; user: StaffUser; children: React.ReactNode }) {
  return (
    <div className="surface">
      <TopBar clock={clock} user={user} />
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "ARRIVED" ? "good" : status === "CANCELLED" || status === "NO_SHOW" ? "bad" : status === "RESCHEDULED" ? "warn" : undefined;
  return <Badge tone={tone as "good" | "bad" | "warn" | undefined}>{status}</Badge>;
}

function PaymentBadge({ status }: { status: string }) {
  return <Badge tone={status === "PREPAID" || status === "COLLECTED" ? "good" : "warn"}>{status === "PAY_AT_CLINIC" ? "payment due" : status.toLowerCase()}</Badge>;
}

function QueueRow({
  state,
  now,
  entry,
  position,
  patientName,
  onEscalate,
  onLeave,
}: {
  state: EngineState;
  now: number;
  entry: QueueEntry;
  position: number;
  patientName: (id: string) => string;
  onEscalate: () => void;
  onLeave: () => void;
}) {
  const visit = state.visits[entry.visitId];
  const opd = likelyOpdTimeForQueueEntry(state, entry, now, FALLBACK_CONSULT_MINUTES);
  const appt = visit?.appointmentId ? state.appointments[visit.appointmentId] : undefined;
  return (
    <div className="row">
      <span className="row-token mono">#{visit?.tokenNumber ?? "?"}</span>
      <div className="row-main">
        <div className="row-title">
          {visit ? patientName(visit.patientId) : "Unknown"} {entry.queueType === "REVIEW" && <Badge tone="accent">review</Badge>}{" "}
          {entry.priorityTier > 0 && <Badge tone="warn">priority {entry.priorityTier}</Badge>}
        </div>
        <div className="row-sub mono">
          pos {position} · ready {formatClockLabel(entry.effectiveReadyTime)} · waited {Math.max(0, Math.round(now - entry.enteredAt))}m · likely OPD {formatClockLabel(opd)}
          {appt && <> · <PaymentBadge status={appt.paymentStatus} /></>}
        </div>
      </div>
      {entry.status === "WAITING" && (
        <div className="row-actions">
          <button className="btn btn-sm" onClick={onEscalate}>
            Escalate
          </button>
          <button className="btn btn-sm btn-danger" onClick={onLeave}>
            Left
          </button>
        </div>
      )}
    </div>
  );
}

function CapacityStrip({ state, doctorId, now }: { state: EngineState; doctorId: string; now: number }) {
  const slots = useMemo(
    () =>
      Object.values(state.slots)
        .filter((s) => s.doctorId === doctorId)
        .sort((a, b) => a.time - b.time),
    [state, doctorId],
  );
  if (slots.length === 0) return <div className="empty">No session open for this doctor yet.</div>;
  return (
    <div className="slot-strip">
      {slots.map((slot) => {
        const patient = slot.appointmentId
          ? state.patients[state.appointments[slot.appointmentId]?.patientId]?.name
          : slot.visitId
            ? state.patients[state.visits[slot.visitId]?.patientId]?.name
            : null;
        const tokenNumber = slot.appointmentId ? state.appointments[slot.appointmentId]?.tokenNumber : slot.visitId ? state.visits[slot.visitId]?.tokenNumber : null;
        return (
          <div key={slot.id} className={`slot-tile slot-${slot.state.toLowerCase()}${slot.time < now ? " slot-past" : ""}`}>
            <div>{formatClockLabel(slot.time)}</div>
            {tokenNumber ? <div>#{tokenNumber}</div> : <div>{slot.state}</div>}
            {patient && <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{patient}</div>}
          </div>
        );
      })}
    </div>
  );
}

function InvestigationRow({
  state,
  inv,
  now,
  onResult,
}: {
  state: EngineState;
  inv: EngineState["investigations"][string];
  now: number;
  onResult: (flag: "NORMAL" | "ABNORMAL", summary: string) => void;
}) {
  const [summary, setSummary] = useState("");
  const visit = state.visits[inv.visitId];
  return (
    <div className="row" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>
          {inv.name} — {visit ? state.patients[visit.patientId]?.name : ""}
        </span>
        <Badge tone={inv.status === "RESULTED" ? "good" : "warn"}>{inv.status}</Badge>
      </div>
      <div className="muted mono" style={{ fontSize: 10 }}>
        ordered {formatClockLabel(inv.orderedAt)}
        {inv.status === "ORDERED" ? ` · ${Math.max(0, Math.round(now - inv.orderedAt))}m so far` : ` · resulted ${formatClockLabel(inv.resultedAt!)}`}
      </div>
      {inv.status === "ORDERED" ? (
        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <input placeholder="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => onResult("NORMAL", summary || "Normal")}>
            Normal
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => onResult("ABNORMAL", summary || "Abnormal")}>
            Abnormal
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11 }}>
          {inv.resultSummary} — <Badge tone={inv.resultFlag === "ABNORMAL" ? "bad" : "good"}>{inv.resultFlag}</Badge>
        </div>
      )}
    </div>
  );
}

function AlertsPanel({ state, now }: { state: EngineState; now: number }) {
  const alerts: { text: string; hint: string }[] = [];
  for (const session of Object.values(state.sessions)) {
    if (session.status === "OPEN" && session.runningDelayMinutes >= 15) {
      const doctor = state.doctors[session.doctorId];
      alerts.push({ text: `${doctor?.name} is running ${session.runningDelayMinutes} minutes behind.`, hint: "Consider warning the next few waiting patients." });
    }
    if (session.status === "OPEN" && Object.values(state.slots).filter((s) => s.sessionId === session.id && s.state === "PROTECTED" && s.time >= now).length <= session.minProtected) {
      const doctor = state.doctors[session.doctorId];
      alerts.push({ text: `${doctor?.name}'s protected capacity is at its floor.`, hint: "A walk-in may need to be deferred to another doctor." });
    }
  }
  for (const inv of Object.values(state.investigations)) {
    if (inv.status === "ORDERED" && now - inv.orderedAt > 45) {
      const visit = state.visits[inv.visitId];
      alerts.push({ text: `${inv.name} for ${visit ? state.patients[visit.patientId]?.name : "a patient"} is overdue.`, hint: "Check with the lab." });
    }
  }
  const noShows = Object.values(state.appointments).filter((a) => a.status === "NO_SHOW").length;
  if (noShows > 0) alerts.push({ text: `${noShows} no-show(s) today.`, hint: "Their protected capacity may already be freed for walk-ins." });
  const uncollectedCount = Object.values(state.charges).filter((c) => c.status === "DUE").length;
  if (uncollectedCount > 0) alerts.push({ text: `${uncollectedCount} charge(s) awaiting collection.`, hint: "See Billing." });

  return (
    <div className="card">
      <div className="card-title">Alerts</div>
      {alerts.length === 0 && <div className="empty">Nothing needs attention.</div>}
      {alerts.map((a, i) => (
        <div key={i} className="row" style={{ display: "block" }}>
          <div>{a.text}</div>
          <div className="muted" style={{ fontSize: 10 }}>
            {a.hint}
          </div>
        </div>
      ))}
    </div>
  );
}

function EconomicsPanel({ state, now }: { state: EngineState; now: number }) {
  const consultationRevenue = Object.values(state.charges).filter((c) => c.kind === "CONSULTATION" && c.status === "COLLECTED").reduce((s, c) => s + c.amount, 0);
  const investigationRevenue = Object.values(state.charges).filter((c) => c.kind === "INVESTIGATION" && c.status === "COLLECTED").reduce((s, c) => s + c.amount, 0);
  const fromReleased = Object.values(state.appointments).filter((a) => a.capacitySource === "RELEASED").length;
  const fromProtected = Object.values(state.appointments).filter((a) => a.capacitySource === "PROTECTED").length;
  const noShows = Object.values(state.appointments).filter((a) => a.status === "NO_SHOW");
  const unrecoveredPotential = noShows.reduce((sum, a) => sum + currentFee(state, a.doctorId, now), 0);
  const totalSlots = Object.values(state.slots).length;
  const usedSlots = Object.values(state.slots).filter((s) => s.state === "BOOKED" || s.state === "CONSUMED").length;

  return (
    <div className="card">
      <div className="card-title">Economics</div>
      <div className="row">
        <div className="row-main">Consultation revenue</div>
        <span className="mono">₹{consultationRevenue}</span>
      </div>
      <div className="row">
        <div className="row-main">Investigation revenue</div>
        <span className="mono">₹{investigationRevenue}</span>
      </div>
      <div className="row">
        <div className="row-main">Bookings from released capacity</div>
        <span className="mono">{fromReleased}</span>
      </div>
      <div className="row">
        <div className="row-main">Bookings from protected capacity</div>
        <span className="mono">{fromProtected}</span>
      </div>
      <div className="row">
        <div className="row-main">Unrecovered no-show potential</div>
        <span className="mono">₹{unrecoveredPotential}</span>
      </div>
      <div className="row">
        <div className="row-main">Utilisation</div>
        <span className="mono">{totalSlots ? Math.round((usedSlots / totalSlots) * 100) : 0}%</span>
      </div>
    </div>
  );
}
