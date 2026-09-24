import { NextRequest, NextResponse } from "next/server";
import type { Command } from "@/lib/engine/commands";
import { dispatch } from "@/lib/server/world";
import { handleRouteError, jsonError } from "@/lib/server/http";
import { getCurrentUser } from "@/lib/server/session";
import { commandEnvelope } from "@/lib/server/actorSchema";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError("Not signed in", 401);

    const body = commandEnvelope.parse(await req.json());
    // The actor comes from the session, never from the body: a client must not be able to
    // claim a role it isn't signed in as. authorize() then applies the per-command rules.
    const command = { ...body, actorRole: user.role, actorId: user.id } as unknown as Command;
    const events = dispatch(command);
    return NextResponse.json({ events });
  } catch (err) {
    return handleRouteError(err);
  }
}
