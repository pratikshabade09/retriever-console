"use client";

// Prototype-only: one-tap sign-in as a fixed demo account, so nobody has to register to see the
// product. Reads its list from /api/demo/accounts (which creates the accounts on first call)
// and hands the credentials back to the page, which signs in through the ordinary login route —
// a demo login is a real login, not a bypass.

import { useEffect, useState } from "react";

interface DemoAccount {
  label: string;
  email: string;
  password: string;
}

export default function DemoLogins({
  audience,
  onSignIn,
  disabled,
}: {
  audience: "staff" | "patient";
  onSignIn: (email: string, password: string) => void;
  disabled?: boolean;
}) {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);

  useEffect(() => {
    fetch(`/api/demo/accounts?audience=${audience}`)
      .then((r) => r.json())
      .then((data: { accounts?: DemoAccount[] }) => setAccounts(data.accounts ?? []))
      .catch(() => {});
  }, [audience]);

  if (accounts.length === 0) return null;

  return (
    <div className="glass-demo">
      <div className="glass-demo-title">Prototype · demo logins</div>
      {accounts.map((account) => (
        <button
          key={account.email}
          type="button"
          className="glass-demo-btn"
          disabled={disabled}
          onClick={() => onSignIn(account.email, account.password)}
        >
          <span className="glass-demo-role">{account.label}</span>
          <span className="glass-demo-cred mono">
            {account.email} · {account.password}
          </span>
        </button>
      ))}
    </div>
  );
}
