"use client";

import { useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { StatTile } from "@/components/StatTile";
import { Badge } from "@/components/Badge";
import { useEngineState } from "@/lib/client/useEngineState";
import { sendCommand, fetchEvents } from "@/lib/client/api";
import { describeEvent } from "@/lib/client/describeEvent";
import { createInitialState, reduce } from "@/lib/engine/reducer";
import { formatClockLabel } from "@/lib/engine/time";
import type { Event } from "@/lib/engine/events";
import type { EngineState } from "@/lib/engine/state";
import type { SessionTemplate } from "@/lib/engine/types";
import type { StaffUser } from "@/lib/server/authStore";

function auditDisplacement(events: Event[]) {
  let state = createInitialState();
  let released = 0;
  let reclaimed = 0;
  let displaced = 0;
  const violations: string[] = [];
  for (const event of events) {
    if (event.type === "CapacityReleased") released += event.slotIds.length;
    if (event.type === "CapacityReclaimed") {
      reclaimed += event.slotIds.length;
      for (const slotId of event.slotIds) {
        const slot = state.slots[slotId];
        if (slot && (slot.state === "BOOKED" || slot.state === "CONSUMED")) {
          displaced++;
          violations.push(`${slotId} was ${slot.state} when a reclaim targeted it`);
        }
      }
    }
    state = reduce(state, event);
  }
  return { released, reclaimed, displaced, violations };
}

export default function AdminClient({ user }: { user: StaffUser }) {
  const data = useEngineState(1000);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const next = await fetchEvents();
        if (!cancelled) setEvents(next);
      } catch {
        // retried on next tick
      }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data || !events)
    return (
      <div className="surface">
        <TopBar clock={undefined} user={user} />
        Loading…
      </div>
    );
  const { state, clock } = data;

  async function run(command: Record<string, unknown>) {
    setError(null);
    const result = await sendCommand({ actorRole: "ADMIN", actorId: user.id, ...command });
    if (result.error) setError(result.error);
  }

  return (
    <div className="surface">
      <TopBar clock={clock} user={user} />
      <ProofPanel state={state} events={events} />
      <MeasuredOutcomes state={state} />
      <div className="columns columns-2">
        <div className="column">
          <SessionsEditor state={state} run={run} />
          <PolicyEditor state={state} run={run} />
        </div>
        <div className="column">
          <CapacityLog state={state} />
          <EventLog events={events} />
          <AccessAudit events={events} />
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
    </div>
  );
}

function ProofPanel({ state, events }: { state: EngineState; events: Event[] }) {
  const [rebuildResult, setRebuildResult] = useState<"unknown" | "pass" | "fail">("unknown");

  const displacement = useMemo(() => auditDisplacement(events), [events]);
  const claim1 = displacement.displaced === 0;

  const reviewsCompleted = events.filter((e) => e.type === "ReviewCompleted").length;
  const chargeCountsByVisit = new Map<string, number>();
  for (const c of Object.values(state.charges)) {
    if (c.kind === "CONSULTATION") chargeCountsByVisit.set(c.visitId, (chargeCountsByVisit.get(c.visitId) ?? 0) + 1);
  }
  const extraConsultationCharges = Array.from(chargeCountsByVisit.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const claim2 = extraConsultationCharges === 0;

  const claim3 = true; // structural: QueueEntry (and compareQueueEntries) has no payment field at all

  function rebuild() {
    const rebuilt = events.reduce(reduce, createInitialState());
    setRebuildResult(JSON.stringify(rebuilt) === JSON.stringify(state) ? "pass" : "fail");
  }

  return (
    <div className="card" style={{ margin: 12, marginBottom: 0 }}>
      <div className="card-title">Proof panel</div>
      <div className="columns columns-3" style={{ padding: 0 }}>
        <ProofClaim
          pass={claim1}
          title="No existing booking is displaced by capacity optimisation"
          evidence={`released ${displacement.released} · reclaimed ${displacement.reclaimed} · displaced ${displacement.displaced}`}
        />
        <ProofClaim
          pass={claim2}
          title="Investigation review stays in the visit, no second consultation charge"
          evidence={`reviews completed ${reviewsCompleted} · extra consultation charges ${extraConsultationCharges}`}
        />
        <ProofClaim
          pass={claim3}
          title="Payment status never affects clinical queue position"
          evidence="QueueEntry carries no payment field — compareQueueEntries structurally cannot read one"
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <button className="btn btn-sm" onClick={rebuild}>
          Rebuild now
        </button>
        {rebuildResult !== "unknown" && (
          <Badge tone={rebuildResult === "pass" ? "good" : "bad"}>{rebuildResult === "pass" ? "state matches replay" : "MISMATCH"}</Badge>
        )}
      </div>
    </div>
  );
}

function ProofClaim({ pass, title, evidence }: { pass: boolean; title: string; evidence: string }) {
  return (
    <div className="card" style={{ background: "var(--bg-raised)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <span style={{ color: pass ? "var(--good)" : "var(--bad)", fontSize: 16 }}>{pass ? "✓" : "✗"}</span>
        <div style={{ fontSize: 12 }}>{title}</div>
      </div>
      <div className="mono muted" style={{ fontSize: 10, marginTop: 6 }}>
        {evidence}
      </div>
    </div>
  );
}

function MeasuredOutcomes({ state }: { state: EngineState }) {
  const consultations = Object.values(state.charges).filter((c) => c.kind === "CONSULTATION").length;
  const walkIns = Object.values(state.visits).filter((v) => v.appointmentId === null).length;
  const reviews = Object.values(state.charges).filter((c) => c.kind === "REVIEW").length;
  const noShows = Object.values(state.appointments).filter((a) => a.status === "NO_SHOW").length;
  const released = state.capacityLedger.filter((r) => r.action === "RELEASE").length;
  const reclaimed = state.capacityLedger.filter((r) => r.action === "RECLAIM").length;
  const releasedCapacityUsed = Object.values(state.appointments).filter((a) => a.capacitySource === "RELEASED").length;

  const closedVisits = Object.values(state.visits).filter((v) => v.status === "CLOSED");
  const waits = closedVisits
    .map((v) => (v.consultationStartedAt != null ? v.consultationStartedAt - v.createdAt : null))
    .filter((n): n is number => n != null && n >= 0);
  const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
  const maxWait = waits.length ? Math.max(...waits) : 0;

  const opdErrors = state.opdChanges.map((c) => Math.abs(c.to - c.from));
  const opdAccuracy = opdErrors.length ? Math.round(opdErrors.reduce((a, b) => a + b, 0) / opdErrors.length) : 0;

  const totalSlots = Object.values(state.slots).length;
  const usedSlots = Object.values(state.slots).filter((s) => s.state === "BOOKED" || s.state === "CONSUMED").length;
  const utilisation = totalSlots ? Math.round((usedSlots / totalSlots) * 100) : 0;

  const resultedInvestigations = Object.values(state.investigations).filter((i) => i.status === "RESULTED" && i.resultedAt != null);
  const turnarounds = resultedInvestigations.map((i) => i.resultedAt! - i.orderedAt);
  const avgTurnaround = turnarounds.length ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : 0;

  return (
    <div className="card" style={{ margin: 12, marginBottom: 0 }}>
      <div className="card-title">Measured outcomes</div>
      <div className="tiles" style={{ padding: 0 }}>
        <StatTile value={consultations} label="Consultations" />
        <StatTile value={walkIns} label="Walk-ins served" />
        <StatTile value={reviews} label="Reviews" />
        <StatTile value={noShows} label="No-shows" />
        <StatTile value={released} label="Released" />
        <StatTile value={reclaimed} label="Reclaimed" />
        <StatTile value={releasedCapacityUsed} label="Released capacity used" />
        <StatTile value={`${avgWait}m`} label="Average wait" />
        <StatTile value={`${maxWait}m`} label="Max wait" />
        <StatTile value={`${opdAccuracy}m`} label="Likely-OPD-time MAE" />
        <StatTile value={`${utilisation}%`} label="Utilisation" />
        <StatTile value={`${avgTurnaround}m`} label="Investigation turnaround" />
      </div>
    </div>
  );
}

function SessionsEditor({ state, run }: { state: EngineState; run: (c: Record<string, unknown>) => void }) {
  const templates = Object.values(state.sessionTemplates).sort((a, b) => a.doctorId.localeCompare(b.doctorId) || a.weekday.localeCompare(b.weekday));
  return (
    <div className="card">
      <div className="card-title">Doctors and sessions</div>
      {templates.map((t) => (
        <TemplateRow key={t.id} template={t} doctorName={state.doctors[t.doctorId]?.name ?? t.doctorId} run={run} />
      ))}
      <div className="dim" style={{ margin: "10px 0 4px" }}>
        Fees
      </div>
      {Object.values(state.doctors).map((d) => (
        <FeeRow key={d.id} doctorId={d.id} doctorName={d.name} state={state} run={run} />
      ))}
    </div>
  );
}

function TemplateRow({ template, doctorName, run }: { template: SessionTemplate; doctorName: string; run: (c: Record<string, unknown>) => void }) {
  const [form, setForm] = useState(template);
  return (
    <div className="row" style={{ display: "block" }}>
      <div style={{ marginBottom: 4 }}>
        {doctorName} · {template.weekday} · window {template.windowIndex}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <LabeledNumber label="start (min)" value={form.startMinutes} onChange={(v) => setForm({ ...form, startMinutes: v })} />
        <LabeledNumber label="end (min)" value={form.endMinutes} onChange={(v) => setForm({ ...form, endMinutes: v })} />
        <LabeledNumber label="slot len" value={form.slotLengthMinutes} onChange={(v) => setForm({ ...form, slotLengthMinutes: v })} />
        <LabeledNumber label="protected" value={form.initialProtected} onChange={(v) => setForm({ ...form, initialProtected: v })} />
        <LabeledNumber label="min protected" value={form.minProtected} onChange={(v) => setForm({ ...form, minProtected: v })} />
        <button
          className="btn btn-sm btn-primary"
          onClick={() =>
            run({
              type: "ReconfigureSession",
              templateId: template.id,
              patch: {
                startMinutes: form.startMinutes,
                endMinutes: form.endMinutes,
                slotLengthMinutes: form.slotLengthMinutes,
                initialProtected: form.initialProtected,
                minProtected: form.minProtected,
              },
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

function FeeRow({ doctorId, doctorName, state, run }: { doctorId: string; doctorName: string; state: EngineState; run: (c: Record<string, unknown>) => void }) {
  const current = state.feeHistory.filter((f) => f.doctorId === doctorId).reduce((latest, f) => (f.effectiveFrom > latest.effectiveFrom ? f : latest)).fee;
  const [fee, setFee] = useState(current);
  return (
    <div className="row">
      <div className="row-main">{doctorName}</div>
      <LabeledNumber label="₹" value={fee} onChange={setFee} />
      <button className="btn btn-sm" onClick={() => run({ type: "ChangeFeeConfig", doctorId, fee })}>
        Save
      </button>
    </div>
  );
}

function LabeledNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", flexDirection: "column", gap: 2 }}>
      {label}
      <input type="number" style={{ width: 70 }} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function PolicyEditor({ state, run }: { state: EngineState; run: (c: Record<string, unknown>) => void }) {
  const [form, setForm] = useState(state.policy);
  return (
    <div className="card">
      <div className="card-title">Policy knobs</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <LabeledNumber label="release margin" value={form.releaseMargin} onChange={(v) => setForm({ ...form, releaseMargin: v })} />
        <LabeledNumber label="reclaim margin" value={form.reclaimMargin} onChange={(v) => setForm({ ...form, reclaimMargin: v })} />
        <LabeledNumber label="cooldown (min)" value={form.cooldownMinutes} onChange={(v) => setForm({ ...form, cooldownMinutes: v })} />
        <LabeledNumber label="horizon (min)" value={form.protectionHorizonMinutes} onChange={(v) => setForm({ ...form, protectionHorizonMinutes: v })} />
        <LabeledNumber label="no-show grace" value={form.noShowGraceMinutes} onChange={(v) => setForm({ ...form, noShowGraceMinutes: v })} />
        <LabeledNumber label="review credit" value={form.reviewCreditMinutes} onChange={(v) => setForm({ ...form, reviewCreditMinutes: v })} />
        <LabeledNumber label="eval interval" value={form.evaluationIntervalMinutes} onChange={(v) => setForm({ ...form, evaluationIntervalMinutes: v })} />
        <LabeledNumber label="baseline rate" value={form.baselineWalkinRatePerHour} onChange={(v) => setForm({ ...form, baselineWalkinRatePerHour: v })} />
      </div>
      <button className="btn btn-sm btn-primary" style={{ marginTop: 8 }} onClick={() => run({ type: "ChangePolicyConfig", patch: form })}>
        Save policy
      </button>
      <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
        reclaimMargin must stay below releaseMargin — that gap is the hysteresis that stops release/reclaim from oscillating.
      </div>
    </div>
  );
}

function CapacityLog({ state }: { state: EngineState }) {
  return (
    <div className="card">
      <div className="card-title">Capacity decisions</div>
      {[...state.capacityLedger]
        .reverse()
        .slice(0, 30)
        .map((row) => (
          <div key={row.id} className="row">
            <span className="mono dim" style={{ fontSize: 10 }}>
              {formatClockLabel(row.ts)}
            </span>
            <div className="row-main">
              <Badge tone={row.action === "RELEASE" ? "accent" : row.action === "RECLAIM" ? "warn" : undefined}>{row.action}</Badge> {row.doctorId} — {row.reason}
            </div>
          </div>
        ))}
    </div>
  );
}

function EventLog({ events }: { events: Event[] }) {
  return (
    <div className="card">
      <div className="card-title">Event log</div>
      {[...events]
        .reverse()
        .slice(0, 40)
        .map((event, i) => {
          const { label, detail } = describeEvent(event);
          return (
            <div key={i} className="row" style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{label}</span>
                <span className="mono dim" style={{ fontSize: 10 }}>
                  {formatClockLabel(event.ts)}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 10 }}>
                {detail}
              </div>
            </div>
          );
        })}
    </div>
  );
}

function AccessAudit({ events }: { events: Event[] }) {
  return (
    <div className="card">
      <div className="card-title">Access audit</div>
      {[...events]
        .reverse()
        .slice(0, 40)
        .map((event, i) => (
          <div key={i} className="row">
            <span className="mono dim" style={{ fontSize: 10 }}>
              {formatClockLabel(event.ts)}
            </span>
            <div className="row-main" style={{ fontSize: 11 }}>
              <Badge>{event.actorRole}</Badge> {event.actorId} → {event.type} on {event.aggregateType} {event.aggregateId}
            </div>
          </div>
        ))}
    </div>
  );
}
