import { NextRequest, NextResponse } from "next/server";
import { getState } from "@/lib/server/world";
import { jsonError } from "@/lib/server/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ tokenNumber: string }> }) {
  const { tokenNumber: tokenParam } = await ctx.params;
  const tokenNumber = Number(tokenParam);
  if (!Number.isFinite(tokenNumber)) return jsonError("tokenNumber must be a number", 400);

  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : 0;

  // A token number alone is only unique within one clinic day, so it can match an older booking
  // that happened to hold the same token. Pass the appointmentId returned by /api/public/book
  // to pin this to exactly one booking.
  const appointmentId = req.nextUrl.searchParams.get("appointmentId");

  const state = getState();
  const notifications = state.notifications
    .filter((n) => n.tokenNumber === tokenNumber && n.ts > since)
    .filter((n) => !appointmentId || n.appointmentId === appointmentId)
    .map((n) => ({ ts: n.ts, kind: n.kind, message: n.message }));

  return NextResponse.json(notifications);
}
