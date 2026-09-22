import { NextRequest, NextResponse } from "next/server";
import { getState } from "@/lib/server/world";
import { jsonError } from "@/lib/server/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ tokenNumber: string }> }) {
  const { tokenNumber: tokenParam } = await ctx.params;
  const tokenNumber = Number(tokenParam);
  if (!Number.isFinite(tokenNumber)) return jsonError("tokenNumber must be a number", 400);

  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : 0;

  const state = getState();
  const notifications = state.notifications
    .filter((n) => n.tokenNumber === tokenNumber && n.ts > since)
    .map((n) => ({ ts: n.ts, kind: n.kind, message: n.message }));

  return NextResponse.json(notifications);
}
