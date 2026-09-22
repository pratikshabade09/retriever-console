import { NextRequest, NextResponse } from "next/server";
import { getState } from "@/lib/server/world";
import { jsonError } from "@/lib/server/http";
import { triage } from "@/lib/engine/triage";

export async function GET(req: NextRequest) {
  const symptom = req.nextUrl.searchParams.get("symptom");
  if (!symptom) return jsonError("symptom query param is required", 400);

  const state = getState();
  return NextResponse.json(triage(symptom, Object.values(state.doctors)));
}
