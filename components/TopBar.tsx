"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatClockLabel } from "@/lib/engine/time";
import { logout, type ClockView } from "@/lib/client/api";

const TABS: Record<string, { href: string; label: string }> = {
  RECEPTION: { href: "/reception", label: "Reception" },
  DOCTOR: { href: "/doctor", label: "Doctor" },
  ADMIN: { href: "/admin", label: "Admin" },
};

export function TopBar({
  clock,
  user,
}: {
  clock: ClockView | undefined;
  user?: { name: string; role: "RECEPTION" | "DOCTOR" | "ADMIN" };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const tab = user ? TABS[user.role] : undefined;

  return (
    <div className="topbar">
      <span className="topbar-clinic">Retriever Console</span>
      <span className="topbar-clock mono">{clock ? formatClockLabel(clock.now) : "--:--"}</span>

      {tab && (
        <div className="topbar-tabs">
          <Link href={tab.href} className={`topbar-tab${pathname?.startsWith(tab.href) ? " active" : ""}`}>
            {tab.label}
          </Link>
        </div>
      )}

      <div className="topbar-spacer" />

      {user && (
        <div className="topbar-user">
          <span>
            <strong>{user.name}</strong> · {user.role.toLowerCase()}
          </span>
          <button
            className="btn btn-sm"
            onClick={async () => {
              await logout();
              router.push("/login");
              router.refresh();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
