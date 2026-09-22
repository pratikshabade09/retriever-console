import { NextResponse } from "next/server";
import { getCurrentPatient } from "@/lib/server/patientSession";

export async function GET() {
  const patient = await getCurrentPatient();
  return NextResponse.json({ patient });
}
