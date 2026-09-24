// Prototype login shortcuts: makes sure the fixed demo identities from demoSeed.ts actually
// exist, then hands the login pages their credentials so a judge can get in with one click.
//
// Everything here is idempotent — it creates what's missing and silently accepts what's already
// there — so it's safe to call on every request. There is no separate "demo mode" in the auth
// systems themselves: the accounts it creates are ordinary rows in the ordinary tables and log
// in through the ordinary routes.

import { AuthError, registerUser } from "./authStore";
import { PatientAuthError, createPatientAccountForPatient, registerPatientAccount } from "./patientAuthStore";
import { DEMO_PASSWORD, DEMO_PATIENT, DEMO_STAFF } from "./demoSeed";
import { getState } from "./world";

export interface DemoCredential {
  label: string;
  email: string;
  password: string;
}

export type DemoAudience = "staff" | "patient";

export function ensureDemoAccounts(): void {
  for (const staff of DEMO_STAFF) {
    try {
      registerUser({
        name: staff.name,
        email: staff.email,
        password: DEMO_PASSWORD,
        role: staff.role,
        doctorId: staff.doctorId,
      });
    } catch (err) {
      // Only the duplicate-email case is expected here; the rest of the input is our own
      // constant, so an AuthError means the account is already in place.
      if (!(err instanceof AuthError)) throw err;
    }
  }

  try {
    // The seeded history already registered this patient — bind the account to that same
    // record so the demo patient's appointments are the account's appointments.
    const patient = Object.values(getState().patients).find((p) => p.phone === DEMO_PATIENT.phone);
    if (patient) {
      createPatientAccountForPatient({
        name: DEMO_PATIENT.name,
        email: DEMO_PATIENT.email,
        phone: DEMO_PATIENT.phone,
        password: DEMO_PASSWORD,
        patientId: patient.id,
      });
    } else {
      // No seeded history (e.g. a database that predates it) — fall back to ordinary
      // registration, which creates the Patient record itself.
      registerPatientAccount({
        name: DEMO_PATIENT.name,
        email: DEMO_PATIENT.email,
        phone: DEMO_PATIENT.phone,
        password: DEMO_PASSWORD,
      });
    }
  } catch (err) {
    if (!(err instanceof PatientAuthError)) throw err;
  }
}

export function demoCredentials(audience: DemoAudience): DemoCredential[] {
  if (audience === "patient") {
    return [{ label: DEMO_PATIENT.label, email: DEMO_PATIENT.email, password: DEMO_PASSWORD }];
  }
  return DEMO_STAFF.map((staff) => ({ label: staff.label, email: staff.email, password: DEMO_PASSWORD }));
}
