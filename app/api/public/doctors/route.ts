import { NextResponse } from "next/server";
import { getClock, getState } from "@/lib/server/world";
import { doctorSummaries } from "@/lib/engine/projections";

export async function GET() {
  const state = getState();
  const { now } = getClock();
  return NextResponse.json(doctorSummaries(state, now));
}
