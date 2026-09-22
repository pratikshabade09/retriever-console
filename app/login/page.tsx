"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLE_HOME: Record<string, string> = { RECEPTION: "/reception", DOCTOR: "/doctor", ADMIN: "/admin" };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not sign in");
        return;
      }
      router.push(ROLE_HOME[data.user.role] ?? "/login");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
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
        <div className="glass-title">Retriever Console</div>
        <div className="glass-subtitle">Staff sign in</div>

        {error && <div className="glass-error">{error}</div>}

        <form onSubmit={onSubmit}>
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

          <div className="glass-row">
            <span>Trouble signing in? Ask your admin.</span>
          </div>

          <button className="glass-btn" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Login"}
          </button>
        </form>

        <div className="glass-footer">
          New here? <a href="/register">Create an account</a>
        </div>
      </div>
    </div>
  );
}
