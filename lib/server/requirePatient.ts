// Server-side route guard for the patient-only area, mirroring requireUser.ts for staff. A
// client component can't safely gate itself, so app/patient/page.tsx (server) calls this
// before rendering the client booking/appointments UI.

import { redirect } from "next/navigation";
import { getCurrentPatient } from "./patientSession";
import type { PatientAccount } from "./patientAuthStore";

export async function requirePatient(next?: string): Promise<PatientAccount> {
  const patient = await getCurrentPatient();
  if (!patient) redirect(next ? `/patient/login?next=${encodeURIComponent(next)}` : "/patient/login");
  return patient;
}
