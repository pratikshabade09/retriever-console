"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PatientAccount } from "@/lib/server/patientAuthStore";

interface DoctorSummary {
  id: string;
  name: string;
  specialty: string;
  room: string;
  consultationFee: number;
  avgWaitMinutes: number;
  availableDays: string[];
}

interface AvailabilitySlot {
  id: string;
  time: number;
  label: string;
}

interface BookingResult {
  tokenNumber: number;
  appointmentId: string;
  doctorName: string;
  slotLabel: string;
  likelyOpdTime: string;
  consultationFee: number;
}

interface AppointmentView {
  appointmentId: string | null;
  visitId: string | null;
  tokenNumber: number;
  status: string;
  doctorName: string;
  dayLabel: string;
  /** Past the appointment's own day — its updates are history, so we don't show them. */
  dayPassed: boolean;
  slotLabel: string;
  likelyOpdTime: string;
  patientsAhead: number;
  paymentStatus: string;
}

interface Notification {
  ts: number;
  kind: string;
  message: string;
  /** Which booking it belongs to — appointmentId for a booking, visitId for a walk-in. */
  appointmentId: string | null;
  visitId: string | null;
}

type Step = "welcome" | "symptom" | "doctors" | "slots" | "form" | "confirmation" | "mine";

/** Steps that can be restored from a URL. `slots`, `form` and `confirmation` can't: they depend
 * on a doctor / slot / booking held in memory for the visit in progress, not on stored data, so
 * a refresh there has nothing to restore and falls back to their bookings. */
const RESTORABLE_STEPS: Step[] = ["welcome", "symptom", "doctors", "mine"];

function stepFromUrl(): Step | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("step");
  return RESTORABLE_STEPS.find((s) => s === raw) ?? null;
}

/** This patient's bookings and their updates. Both come from the server — the browser keeps no
 * copy, so signing in always shows the same thing as the clinic sees. */
async function fetchMyBookings(): Promise<{ appointments: AppointmentView[]; notifications: Notification[] }> {
  const [appointmentsRes, notificationsRes] = await Promise.all([
    fetch("/api/patient/appointments"),
    fetch("/api/patient/notifications?since=0"),
  ]);
  const appointmentsData = await appointmentsRes.json();
  const notificationsData = await notificationsRes.json();
  return { appointments: appointmentsData.appointments ?? [], notifications: notificationsData.notifications ?? [] };
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

export default function PatientClient({ patient }: { patient: PatientAccount }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [symptom, setSymptom] = useState("");
  const [triageNote, setTriageNote] = useState<string | null>(null);

  const [doctors, setDoctors] = useState<DoctorSummary[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorSummary | null>(null);
  const [selectedDate, setSelectedDate] = useState(nextSevenDays()[0].date);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);

  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"PAY_AT_CLINIC" | "PREPAID">("PAY_AT_CLINIC");
  const [bookingNotifications, setBookingNotifications] = useState<Notification[]>([]);

  const [myAppointments, setMyAppointments] = useState<AppointmentView[] | null>(null);
  const [myNotifications, setMyNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    fetch("/api/public/doctors")
      .then((r) => r.json())
      .then(setDoctors)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDoctor) return;
    fetch(`/api/public/availability?doctorId=${selectedDoctor.id}&date=${selectedDate}`)
      .then((r) => r.json())
      .then((data) => {
        setSlots(data.slots ?? []);
        setSelectedSlot(null);
      })
      .catch(() => {});
  }, [selectedDoctor, selectedDate]);

  useEffect(() => {
    // One-time restore. Put them back on the step the URL names, or — when they already have
    // bookings — open on those instead of walking the booking flow again from the start.
    void fetchMyBookings()
      .then(({ appointments, notifications }) => {
        setMyAppointments(appointments);
        setMyNotifications(notifications);
        const fromUrl = stepFromUrl();
        if (fromUrl) setStep(fromUrl);
        else if (appointments.length > 0) setStep("mine");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Keep the step in the URL so a refresh, or a link, lands on the same screen. Replaced
    // rather than pushed — Back shouldn't re-open every step passed through.
    const url = new URL(window.location.href);
    if (step === "welcome") url.searchParams.delete("step");
    else url.searchParams.set("step", step);
    window.history.replaceState(null, "", url);
  }, [step]);

  useEffect(() => {
    if (!booking) return;
    // The signed-in patient's own feed, then narrowed to this booking by id — a token number
    // alone also matches an older booking that held the same token on another day.
    const load = () =>
      fetch("/api/patient/notifications?since=0")
        .then((r) => r.json())
        .then((data: { notifications?: Notification[] }) => {
          setBookingNotifications((data.notifications ?? []).filter((n) => n.appointmentId === booking.appointmentId));
        })
        .catch(() => {});
    void load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [booking]);

  async function loadMyAppointments() {
    const { appointments, notifications } = await fetchMyBookings();
    setMyAppointments(appointments);
    setMyNotifications(notifications);
  }

  async function runTriage() {
    if (!symptom.trim()) return;
    const res = await fetch(`/api/public/triage?symptom=${encodeURIComponent(symptom)}`);
    const data = await res.json();
    setTriageNote(`Based on your reason for visit, we'd suggest seeing a ${data.specialty}. ${data.rationale}`);
    const match = doctors.find((d) => d.id === data.suggestedDoctorId);
    if (match) setSelectedDoctor(match);
    setStep("slots");
  }

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDoctor || !selectedSlot) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId: selectedDoctor.id, slotId: selectedSlot.id, name: patient.name, phone: patient.phone, reason: reason || symptom || "consultation" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not book that slot");
        return;
      }
      setBooking(data);
      setPaymentStatus("PAY_AT_CLINIC");
      setBookingNotifications([]);
      setStep("confirmation");
    } finally {
      setSubmitting(false);
    }
  }

  async function payNow() {
    if (!booking) return;
    // Addressed by appointment id, not token number: token numbers repeat every clinic day.
    const res = await fetch("/api/public/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId: booking.appointmentId }),
    });
    if (res.ok) setPaymentStatus("PREPAID");
  }

  const doctorInitial = useMemo(() => (selectedDoctor ? selectedDoctor.name.replace("Dr. ", "").slice(0, 1) : ""), [selectedDoctor]);

  return (
    <div className="patient-shell">
      <div style={{ width: "100%", maxWidth: 480, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          Signed in as <strong style={{ color: "var(--text)" }}>{patient.name}</strong>
        </span>
        <button
          className="btn btn-sm"
          onClick={async () => {
            await fetch("/api/patient/logout", { method: "POST" });
            router.push("/");
            router.refresh();
          }}
        >
          Log out
        </button>
      </div>

      {/* Always offer a way out of whatever screen they're on: back to the dashboard from
          anywhere, and straight into booking from the two screens that don't start one. */}
      {step !== "welcome" && (
        <div style={{ width: "100%", maxWidth: 480, display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <button className="btn btn-sm" onClick={() => setStep("welcome")}>
            ← Dashboard
          </button>
          {(step === "mine" || step === "confirmation") && (
            <button className="btn btn-sm btn-primary" onClick={() => setStep("doctors")}>
              Book an appointment
            </button>
          )}
        </div>
      )}

      <div className="patient-header">
        <h1>Retriever Clinic</h1>
        <p>Book an appointment, or check on one you&apos;ve already made.</p>
      </div>

      <div className="patient-panel">
        {step === "welcome" && (
          <div className="choice-row" style={{ flexDirection: "column" }}>
            <button className="choice-btn" onClick={() => setStep("doctors")}>
              <div className="choice-title">Book an appointment</div>
              <div className="choice-sub">Choose a doctor and a time that works for you</div>
            </button>
            <button className="choice-btn" onClick={() => setStep("symptom")}>
              <div className="choice-title">Not sure who to see?</div>
              <div className="choice-sub">Tell us your symptom and we&apos;ll suggest a doctor</div>
            </button>
            <button
              className="choice-btn"
              onClick={() => {
                setStep("mine");
                void loadMyAppointments();
              }}
            >
              <div className="choice-title">My appointments</div>
              <div className="choice-sub">Everything you&apos;ve booked, with live status</div>
            </button>
          </div>
        )}

        {step === "symptom" && (
          <>
            <span className="back-link" onClick={() => setStep("welcome")}>
              ← Back
            </span>
            <div className="glass-field">
              <input placeholder="e.g. itchy skin, chest pain, fever" value={symptom} onChange={(e) => setSymptom(e.target.value)} autoFocus />
            </div>
            <button className="glass-btn" onClick={runTriage} disabled={!symptom.trim()}>
              Continue
            </button>
          </>
        )}

        {step === "doctors" && (
          <>
            <span className="back-link" onClick={() => setStep("welcome")}>
              ← Back
            </span>
            {doctors.length === 0 && <div className="empty">Loading doctors…</div>}
            {doctors.map((d) => (
              <div
                key={d.id}
                className="doctor-card"
                onClick={() => {
                  setSelectedDoctor(d);
                  setStep("slots");
                }}
              >
                <div className="doctor-avatar">{d.name.replace("Dr. ", "").slice(0, 1)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{d.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {d.specialty} · Avg wait ~{d.avgWaitMinutes} min · ₹{d.consultationFee}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {step === "slots" && selectedDoctor && (
          <>
            <span
              className="back-link"
              onClick={() => {
                setStep(triageNote ? "symptom" : "doctors");
                setTriageNote(null);
              }}
            >
              ← Back
            </span>
            {triageNote && <div className="glass-error" style={{ background: "rgba(74,222,128,0.12)", borderColor: "var(--accent)", color: "var(--accent)" }}>{triageNote}</div>}
            <div className="doctor-card" style={{ cursor: "default" }}>
              <div className="doctor-avatar">{doctorInitial}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{selectedDoctor.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {selectedDoctor.specialty} · Avg wait ~{selectedDoctor.avgWaitMinutes} min
                </div>
              </div>
            </div>

            <div className="glass-field" style={{ background: "rgba(255,255,255,0.08)" }}>
              <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ color: "var(--text)" }}>
                {nextSevenDays().map((d) => (
                  <option key={d.date} value={d.date} style={{ color: "#000" }}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            {slots.length === 0 ? (
              <div className="empty">No slots available this day — try another date.</div>
            ) : (
              <div className="slot-grid">
                {slots.map((s) => (
                  <div
                    key={s.id}
                    className={`slot-pill${selectedSlot?.id === s.id ? " selected" : ""}`}
                    onClick={() => {
                      setSelectedSlot(s);
                      setStep("form");
                    }}
                  >
                    {s.label}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {step === "form" && selectedDoctor && selectedSlot && (
          <form onSubmit={submitBooking}>
            <span className="back-link" onClick={() => setStep("slots")}>
              ← Back
            </span>
            <div className="dim" style={{ marginBottom: 10, fontSize: 12 }}>
              {selectedDoctor.name} · {selectedSlot.label}
            </div>
            {error && <div className="glass-error">{error}</div>}
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="row-main">Booking for</div>
              <span>
                {patient.name} · {patient.phone}
              </span>
            </div>
            <div className="glass-field">
              <input placeholder="Reason for visit" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </div>
            <button className="glass-btn" type="submit" disabled={submitting}>
              {submitting ? "Booking…" : "Confirm booking"}
            </button>
          </form>
        )}

        {step === "confirmation" && booking && (
          <>
            <div className="confirm-token">
              <div className="muted" style={{ fontSize: 11 }}>
                Token
              </div>
              <div className="token-number">#{booking.tokenNumber}</div>
            </div>
            <div className="row">
              <div className="row-main">Doctor</div>
              <span>{booking.doctorName}</span>
            </div>
            <div className="row">
              <div className="row-main">Time</div>
              <span className="mono">{booking.slotLabel}</span>
            </div>
            <div className="row">
              <div className="row-main">Likely OPD time</div>
              <span className="mono">{booking.likelyOpdTime}</span>
            </div>
            <div className="row">
              <div className="row-main">Consultation charges</div>
              <span className="mono">₹{booking.consultationFee}</span>
            </div>
            <div className="row">
              <div className="row-main">Payment</div>
              <span>{paymentStatus === "PREPAID" ? "Prepaid ✓" : "Pay in hospital"}</span>
            </div>

            {paymentStatus === "PAY_AT_CLINIC" && (
              <div className="choice-row" style={{ marginTop: 14 }}>
                <button className="choice-btn" onClick={payNow}>
                  <div className="choice-title">Make payment & skip queue</div>
                  <div className="choice-sub">Skips the billing counter only — your place in line is unchanged</div>
                </button>
                <button className="choice-btn" onClick={() => {}}>
                  <div className="choice-title">Pay in hospital</div>
                  <div className="choice-sub">Settle up at the billing counter when you arrive</div>
                </button>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
                Updates
              </div>
              {bookingNotifications.length === 0 && <div className="empty">No updates yet.</div>}
              {bookingNotifications.map((n, i) => (
                <div key={i} className="row" style={{ display: "block" }}>
                  {n.message}
                </div>
              ))}
            </div>

            <button
              className="btn btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => {
                setStep("welcome");
                setBooking(null);
                setSelectedDoctor(null);
                setSelectedSlot(null);
                setReason("");
              }}
            >
              Done
            </button>
          </>
        )}

        {step === "mine" && (
          <>
            {myAppointments === null && <div className="empty">Loading…</div>}
            {myAppointments?.length === 0 && <div className="empty">You haven&apos;t booked anything yet.</div>}
            {myAppointments?.map((a) => {
              // Matched by id, not token number: the same patient can hold the same token twice.
              const updates = myNotifications.filter((n) =>
                a.appointmentId ? n.appointmentId === a.appointmentId : n.visitId === a.visitId,
              );
              return (
                <div key={a.appointmentId ?? a.visitId ?? `token-${a.tokenNumber}`} className="row" style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="row-token mono">#{a.tokenNumber}</span>
                    <span>{a.status}</span>
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {a.doctorName} · {a.dayLabel} {a.slotLabel}
                  </div>
                  <div className="muted mono" style={{ fontSize: 11 }}>
                    likely OPD {a.likelyOpdTime} · {a.patientsAhead} ahead · {a.paymentStatus}
                  </div>

                  {!a.dayPassed && updates.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div className="dim" style={{ fontSize: 10, marginBottom: 2 }}>
                        Updates
                      </div>
                      {updates.map((n, i) => (
                        <div key={i} className="muted" style={{ fontSize: 11 }}>
                          {n.message}
                        </div>
                      ))}
                    </div>
                  )}

                  {a.status === "BOOKED" && a.appointmentId && (
                    <button
                      className="btn btn-sm btn-danger"
                      style={{ marginTop: 6 }}
                      onClick={async () => {
                        await fetch("/api/public/cancel", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ appointmentId: a.appointmentId }),
                        });
                        await loadMyAppointments();
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
