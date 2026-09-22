import { NextRequest, NextResponse } from "next/server";
import type { Command } from "@/lib/engine/commands";
import { dispatch } from "@/lib/server/world";
import { handleRouteError } from "@/lib/server/http";
import { commandEnvelope } from "@/lib/server/actorSchema";

export async function POST(req: NextRequest) {
  try {
    const body = commandEnvelope.parse(await req.json());
    const events = dispatch(body as unknown as Command);
    return NextResponse.json({ events });
  } catch (err) {
    return handleRouteError(err);
  }
}
