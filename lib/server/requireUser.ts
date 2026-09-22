// Server-side route guard for the three staff surfaces. Each surface's page.tsx is a server
// component that calls this before rendering anything — a client component can't safely gate
// itself (the guard would run after the page already shipped to the browser), so the split is:
// page.tsx (server, guards + redirects) renders a *Client.tsx (client, the interactive surface).

import { redirect } from "next/navigation";
import { getCurrentUser } from "./session";
import type { StaffRole, StaffUser } from "./authStore";

const HOME_BY_ROLE: Record<StaffRole, string> = { RECEPTION: "/reception", DOCTOR: "/doctor", ADMIN: "/admin" };

export async function requireUser(role: StaffRole): Promise<StaffUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(HOME_BY_ROLE[user.role]);
  return user;
}
