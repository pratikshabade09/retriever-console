"use client";

import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Badge } from "@/components/Badge";
import { useEngineState } from "@/lib/client/useEngineState";
import { sendCommand } from "@/lib/client/api";
import { activeQueueForDoctor } from "@/lib/engine/queue";
import { doctorRunningDelayMinutes } from "@/lib/engine/opd";
import { dayNumberToDate, formatClockLabel } from "@/lib/engine/time";
import type { EngineState } from "@/lib/engine/state";
import type { StaffUser } from "@/lib/server/authStore";

export default function DoctorClient({ user }: { user: StaffUser }) {
  const data = useEngineState(1000);
  const [error, setError] = useState<string | null>(null);
  const doctorId = user.doctorId!;
  const [investigationService, setInvestigationService] = useState("cbc");
  const [followUpDays, setFollowUpDays] = useState(7);
  const [pauseReason, setPauseReason] = useState("");
  const [note, setNote] = useState<string | null>(null);

  if (!data)
    return (
      <div className="surface">
        <TopBar clock={undefined} user={user} />
        Loading…
      </div>
    );
  const { state, clock } = data;
  const now = clock.now;

  async function run(command: Record<string, unknown>) {
    setError(null);
    const result = await sendCommand({ actorRole: "DOCTOR", actorId: user.id, ...command });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (command.type === "ResumeSession") {
      const notified = (result.events ?? []).filter((e) => (e as { type?: string }).type === "LikelyOpdTimeChanged").length;
      setNote(notified > 0 ? `Resumed — pushed updated likely OPD times to ${notified} waiting patient(s).` : "Resumed — no waiting patients were affected.");
    }
  }

  const doctor = state.doctors[doctorId];
  const queue = activeQueueForDoctor(state, doctorId);
  const current = queue.find((q) => q.status === "IN_PROGRESS");
  const waiting = queue.filter((q) => q.status === "WAITING");
  const head = waiting[0];

  const currentVisit = current ? state.visits[current.visitId] : undefined;
  const currentAppointment = currentVisit?.appointmentId ? state.appointments[currentVisit.appointmentId] : undefined;
  const delay = doctorRunningDelayMinutes(state, doctorId, now);

  const reviewQueue = queue.filter((q) => q.queueType === "REVIEW" && q.status === "WAITING");

  return (
    <div className="surface">
      <TopBar clock={clock} user={user} />
      <div className="card" style={{ margin: 12, marginBottom: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{doctor?.name}</div>
          <div className="dim" style={{ fontSize: 11 }}>{doctor?.specialty} · {doctor?.room}</div>
        </div>
        <Badge tone={delay > 0 ? "warn" : "good"}>{delay > 0 ? `running ${delay} minutes behind` : "on time"}</Badge>
      </div>

      <div className="columns columns-2">
        <div className="column">
          <div className="card">
            <div className="card-title">Current patient</div>
            {!current ? (
              head ? (
                <div>
                  <div>
                    Next: <strong>{describePatient(state, head)}</strong> {head.queueType === "REVIEW" && <Badge tone="accent">review</Badge>}
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 8 }}
                    onClick={() => run(head.queueType === "REVIEW" ? { type: "StartReview", queueEntryId: head.id } : { type: "StartConsultation", queueEntryId: head.id })}
                  >
                    {head.queueType === "REVIEW" ? "Start review" : "Start consultation"}
                  </button>
                </div>
              ) : (
                <div className="empty">No one waiting.</div>
              )
            ) : (
              <div>
                <div style={{ fontSize: 16, marginBottom: 4 }}>
                  #{currentVisit?.tokenNumber} — {currentVisit && state.patients[currentVisit.patientId]?.name}{" "}
                  <Badge tone={currentAppointment ? "good" : "warn"}>{currentAppointment ? "booked" : "walk-in"}</Badge>{" "}
                  {current.queueType === "REVIEW" && <Badge tone="accent">review</Badge>}
                </div>
                <div className="muted mono" style={{ marginBottom: 8 }}>
                  started {formatClockLabel(currentVisit?.consultationStartedAt ?? now)} · elapsed {Math.max(0, Math.round(now - (currentVisit?.consultationStartedAt ?? now)))}m
                </div>
                <div style={{ marginBottom: 8 }}>Reason: {currentVisit?.reason}</div>

                <div className="dim" style={{ marginBottom: 4 }}>
                  Investigations
                </div>
                {Object.values(state.investigations)
                  .filter((i) => i.visitId === currentVisit?.id)
                  .map((i) => (
                    <div key={i.id} className="row">
                      <div className="row-main">{i.name}</div>
                      {i.status === "RESULTED" ? <Badge tone={i.resultFlag === "ABNORMAL" ? "bad" : "good"}>{i.resultFlag}</Badge> : <Badge tone="warn">pending</Badge>}
                    </div>
                  ))}

                <div className="dim" style={{ margin: "8px 0 4px" }}>
                  Charges so far
                </div>
                {Object.values(state.charges)
                  .filter((c) => c.visitId === currentVisit?.id)
                  .map((c) => (
                    <div key={c.id} className="row">
                      <div className="row-main">{c.kind}</div>
                      <span className="mono">₹{c.amount}</span>
                    </div>
                  ))}

                {current.queueType === "CONSULT" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    <select value={investigationService} onChange={(e) => setInvestigationService(e.target.value)}>
                      {Object.values(state.services).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} — ₹{s.price}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm" onClick={() => currentVisit && run({ type: "OrderInvestigation", visitId: currentVisit.id, serviceId: investigationService })}>
                      Order investigation
                    </button>
                    <input
                      type="number"
                      style={{ width: 60 }}
                      value={followUpDays}
                      onChange={(e) => setFollowUpDays(Number(e.target.value))}
                    />
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        currentVisit &&
                        run({ type: "SetFollowUp", visitId: currentVisit.id, dueDate: dayNumberToDate(Math.floor(now / 1440) + followUpDays) })
                      }
                    >
                      Set follow-up
                    </button>
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ marginTop: 10 }}
                  onClick={() =>
                    currentVisit &&
                    run(current.queueType === "REVIEW" ? { type: "CompleteReview", visitId: currentVisit.id } : { type: "CompleteConsultation", visitId: currentVisit.id })
                  }
                >
                  {current.queueType === "REVIEW" ? "Complete review & close visit" : "End consultation"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="column">
          <div className="card">
            <div className="card-title">Next three</div>
            {waiting.length === 0 && <div className="empty">Queue is empty.</div>}
            {waiting.slice(0, 3).map((q) => (
              <div key={q.id} className="row">
                <div className="row-main">
                  {describePatient(state, q)} {q.queueType === "REVIEW" && <Badge tone="accent">review</Badge>}
                </div>
                <span className="mono muted">waited {Math.max(0, Math.round(now - q.enteredAt))}m</span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title">Review queue</div>
            {reviewQueue.length === 0 && <div className="empty">Nothing awaiting review.</div>}
            {reviewQueue.map((q) => {
              const visit = state.visits[q.visitId];
              const inv = Object.values(state.investigations).find((i) => i.visitId === visit?.id && i.status === "RESULTED");
              return (
                <div key={q.id} className="row" style={{ display: "block" }}>
                  <div>{visit && state.patients[visit.patientId]?.name} — same visit, no new appointment</div>
                  {inv && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {inv.name}: {inv.resultSummary} <Badge tone={inv.resultFlag === "ABNORMAL" ? "bad" : "good"}>{inv.resultFlag}</Badge>
                    </div>
                  )}
                  <div className="mono muted" style={{ fontSize: 10 }}>
                    waited {Math.max(0, Math.round(now - q.enteredAt))}m
                  </div>
                  <button className="btn btn-sm btn-primary" style={{ marginTop: 4 }} disabled={!!current} onClick={() => run({ type: "StartReview", queueEntryId: q.id })}>
                    Start review
                  </button>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="card-title">Session controls</div>
            {Object.values(state.sessions)
              .filter((s) => s.doctorId === doctorId)
              .map((session) => (
                <div key={session.id} className="row">
                  <div className="row-main">
                    {formatClockLabel(session.startAt)}–{formatClockLabel(session.endAt)} <Badge tone={session.status === "OPEN" ? "good" : session.status === "PAUSED" ? "warn" : undefined}>{session.status}</Badge>
                  </div>
                  {session.status === "OPEN" && (
                    <div className="row-actions">
                      <input placeholder="Reason" style={{ width: 90 }} value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} />
                      <button className="btn btn-sm" onClick={() => run({ type: "PauseSession", sessionId: session.id, reason: pauseReason || "break" })}>
                        Pause
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => run({ type: "EndSession", sessionId: session.id })}>
                        End
                      </button>
                    </div>
                  )}
                  {session.status === "PAUSED" && (
                    <button className="btn btn-sm btn-primary" onClick={() => run({ type: "ResumeSession", sessionId: session.id })}>
                      Resume
                    </button>
                  )}
                </div>
              ))}
          </div>
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
      {note && !error && (
        <div className="card" style={{ position: "fixed", bottom: 12, right: 12, borderColor: "var(--accent)", maxWidth: 360 }}>
          <div style={{ color: "var(--accent)", fontSize: 12 }}>{note}</div>
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setNote(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function describePatient(state: EngineState, entry: { visitId: string }): string {
  const visit = state.visits[entry.visitId];
  if (!visit) return "Unknown";
  return `#${visit.tokenNumber} ${state.patients[visit.patientId]?.name ?? "Unknown"}`;
}
