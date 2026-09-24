"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ROLE_HOME: Record<string, string> = { RECEPTION: "/reception", DOCTOR: "/doctor", ADMIN: "/admin" };

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"RECEPTION" | "ADMIN">("RECEPTION");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create account");
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
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
            <path d="M19 8v4M17 10h4" />
          </svg>
        </div>
        <div className="glass-title">Create staff account</div>
        <div className="glass-subtitle">Retriever Console</div>

        {error && <div className="glass-error">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="glass-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16241a" strokeWidth="2">
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5 20c0-3.3 3-5 7-5s7 1.7 7 5" />
            </svg>
            <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="glass-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16241a" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="glass-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16241a" strokeWidth="2">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 018 0v3" />
            </svg>
            <input type="password" placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>

          <div className="glass-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16241a" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="RECEPTION">Reception</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>

          <button className="glass-btn" type="submit" disabled={submitting} style={{ marginTop: 6 }}>
            {submitting ? "Creating account…" : "Register"}
          </button>
        </form>

        <div className="glass-footer">
          Already have an account? <a href="/login">Sign in</a>
        </div>
        <div className="glass-footer">
          Doctor? An admin creates your account from the admin panel.
        </div>
        <div className="glass-footer">
          <Link href="/">← Back to the homepage</Link>
        </div>
      </div>
    </div>
  );
}
