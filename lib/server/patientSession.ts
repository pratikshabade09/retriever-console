// Reading the current patient session from its own cookie — separate from the staff session
// cookie (session.ts), so a patient and a staff member can even be signed in in the same
// browser without one clobbering the other.

import { cookies } from "next/headers";
import { getPatientAccountBySession, type PatientAccount } from "./patientAuthStore";

export const PATIENT_SESSION_COOKIE = "rc_patient_session";

export async function getCurrentPatient(): Promise<PatientAccount | null> {
  const store = await cookies();
  const token = store.get(PATIENT_SESSION_COOKIE)?.value;
  if (!token) return null;
  return getPatientAccountBySession(token);
}
