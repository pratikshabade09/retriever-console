"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import DemoLogins from "@/components/DemoLogins";

function PatientLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/patient";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signIn(nextEmail: string, nextPassword: string) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/patient/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail, password: nextPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not sign in");
        return;
      }
      router.push(next);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void signIn(email, password);
  }

  /** Prototype shortcut: fill the form so it's obvious whose account is being used, then go. */
  function onDemoSignIn(demoEmail: string, demoPassword: string) {
    setEmail(demoEmail);
    setPassword(demoPassword);
    void signIn(demoEmail, demoPassword);
  }

  return (
    <div className="glass-page">
      <div className="glass-card">
        <div className="glass-avatar">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
          </svg>
        </div>
        <div className="glass-title">Retriever Clinic</div>
        <div className="glass-subtitle">Patient sign in</div>

        {error && <div className="glass-error">{error}</div>}

        <DemoLogins audience="patient" onSignIn={onDemoSignIn} disabled={submitting} />

        <form onSubmit={onSubmit} style={{ marginTop: '10px' }}>
          <div className="glass-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16241a" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="glass-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16241a" strokeWidth="2">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 018 0v3" />
            </svg>
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          <button className="glass-btn" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Login"}
          </button>
        </form>

        <div className="glass-footer">
          New patient? <a href={`/patient/register?next=${encodeURIComponent(next)}`}>Create an account</a>
        </div>
        <div className="glass-footer">
          <Link href="/">← Back to the homepage</Link>
        </div>
      </div>
    </div>
  );
}

export default function PatientLoginPage() {
  return (
    <Suspense>
      <PatientLoginForm />
    </Suspense>
  );
}
