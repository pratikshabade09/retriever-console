// The prototype's login shortcuts, as JSON: which demo identities exist on the login pages and
// the password they share. Creating them is idempotent (see demoAccounts.ts), so opening a
// login page is enough — there is no separate "seed the demo" step for a judge to run.
//
// This route is deliberately public and deliberately reveals working credentials. That is the
// point of the prototype (see CLAUDE.md); it must be deleted along with the demo panel on the
// login pages before this app carries any real data.

import { NextRequest, NextResponse } from "next/server";
import { demoCredentials, ensureDemoAccounts, type DemoAudience } from "@/lib/server/demoAccounts";
import { jsonError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const audience = req.nextUrl.searchParams.get("audience");
  if (audience !== "staff" && audience !== "patient") return jsonError("audience must be staff or patient", 400);

  ensureDemoAccounts();
  return NextResponse.json({ accounts: demoCredentials(audience as DemoAudience) });
}
