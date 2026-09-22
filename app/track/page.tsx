"use client";

import { useState } from "react";
import Link from "next/link";

interface AppointmentView {
  status: string;
  doctorName: string;
  slotLabel: string;
  likelyOpdTime: string;
  patientsAhead: number;
  paymentStatus: string;
}

interface Notification {
  ts: number;
  kind: string;
  message: string;
}

export default function TrackPage() {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<AppointmentView | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refreshLookup() {
    setError(null);
    setResult(null);
    const tokenNumber = Number(token);
    if (!Number.isFinite(tokenNumber)) {
      setError("Enter a token number");
      return;
    }
    const [apptRes, notifRes] = await Promise.all([fetch(`/api/public/appointment/${tokenNumber}`), fetch(`/api/public/notifications/${tokenNumber}?since=0`)]);
    if (!apptRes.ok) {
      const data = await apptRes.json();
      setError(data.error ?? "Appointment not found");
      return;
    }
    setResult(await apptRes.json());
    setNotifications(notifRes.ok ? await notifRes.json() : []);
  }

  function lookup(e: React.FormEvent) {
    e.preventDefault();
    void refreshLookup();
  }

  return (
    <div className="patient-shell">
      <div className="patient-header">
        <h1>Track an appointment</h1>
        <p>Booked at the clinic and don&apos;t have an account? Look up your token here.</p>
      </div>

      <div className="patient-panel">
        <form onSubmit={lookup}>
          <div className="glass-field">
            <input placeholder="Token number" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
          </div>
          {error && <div className="glass-error">{error}</div>}
          <button className="glass-btn" type="submit">
            Look up
          </button>
        </form>

        {result && (
          <div style={{ marginTop: 16 }}>
            <div className="row">
              <div className="row-main">Status</div>
              <span>{result.status}</span>
            </div>
            <div className="row">
              <div className="row-main">Doctor</div>
              <span>{result.doctorName}</span>
            </div>
            <div className="row">
              <div className="row-main">Slot</div>
              <span className="mono">{result.slotLabel}</span>
            </div>
            <div className="row">
              <div className="row-main">Likely OPD time</div>
              <span className="mono">{result.likelyOpdTime}</span>
            </div>
            <div className="row">
              <div className="row-main">Patients ahead</div>
              <span>{result.patientsAhead}</span>
            </div>
            <div className="row">
              <div className="row-main">Payment</div>
              <span>{result.paymentStatus}</span>
            </div>

            {notifications.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
                  Updates
                </div>
                {notifications.map((n, i) => (
                  <div key={i} className="row" style={{ display: "block" }}>
                    {n.message}
                  </div>
                ))}
              </div>
            )}

            {result.status === "BOOKED" && (
              <button
                className="btn btn-sm btn-danger"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  await fetch("/api/public/cancel", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tokenNumber: Number(token) }),
                  });
                  await refreshLookup();
                }}
              >
                Cancel appointment
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <Link href="/" style={{ color: "var(--text-dim)", fontSize: 12 }}>
          ← Back to the homepage
        </Link>
      </div>
    </div>
  );
}
