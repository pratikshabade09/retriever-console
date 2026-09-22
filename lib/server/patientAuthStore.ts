// Patient accounts and sessions — deliberately a completely separate table set, separate
// session cookie, and separate route namespace from staff auth (authStore.ts/session.ts).
// A patient logging in never touches the staff `users`/`sessions` tables and vice versa.
//
// Registering a patient account also creates the domain Patient record through the ordinary
// RegisterPatient command (see world.ts's dispatch) — the account just remembers which
// engine `patientId` it's bound to, the same way a DOCTOR staff account remembers its
// `doctorId`. There is still exactly one way a Patient enters the system: a command.

import crypto from "node:crypto";
import { getDb } from "./store";
import { dispatch } from "./world";

export interface PatientAccount {
  id: string;
  name: string;
  email: string;
  phone: string;
  patientId: string;
}

let initialized = false;
function ensureSchema(): void {
  if (initialized) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS patient_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      patient_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS patient_sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  initialized = true;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function rowToAccount(row: { id: string; name: string; email: string; phone: string; patient_id: string }): PatientAccount {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, patientId: row.patient_id };
}

export class PatientAuthError extends Error {}

export function registerPatientAccount(params: { name: string; email: string; phone: string; password: string }): PatientAccount {
  ensureSchema();
  const email = params.email.trim().toLowerCase();
  if (!params.name.trim()) throw new PatientAuthError("Name is required");
  if (!email.includes("@")) throw new PatientAuthError("A valid email is required");
  if (!params.phone.trim()) throw new PatientAuthError("Phone number is required");
  if (params.password.length < 8) throw new PatientAuthError("Password must be at least 8 characters");

  const existing = getDb().prepare("SELECT id FROM patient_accounts WHERE email = ?").get(email);
  if (existing) throw new PatientAuthError("An account with that email already exists");

  const events = dispatch({ type: "RegisterPatient", name: params.name.trim(), phone: params.phone.trim(), actorRole: "PATIENT", actorId: "patient-portal" });
  const registered = events.find((e) => e.type === "PatientRegistered");
  const patientId = registered && "patientId" in registered ? registered.patientId : null;
  if (!patientId) throw new PatientAuthError("Could not create patient record");

  const id = `patient-account-${crypto.randomUUID()}`;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(params.password, salt);
  getDb()
    .prepare("INSERT INTO patient_accounts (id, name, email, phone, password_hash, password_salt, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, params.name.trim(), email, params.phone.trim(), hash, salt, patientId);

  return { id, name: params.name.trim(), email, phone: params.phone.trim(), patientId };
}

export function verifyPatientLogin(email: string, password: string): PatientAccount {
  ensureSchema();
  const row = getDb().prepare("SELECT * FROM patient_accounts WHERE email = ?").get(email.trim().toLowerCase()) as
    | { id: string; name: string; email: string; phone: string; password_hash: string; password_salt: string; patient_id: string }
    | undefined;
  if (!row) throw new PatientAuthError("No account with that email");

  const candidate = hashPassword(password, row.password_salt);
  const expected = Buffer.from(row.password_hash, "hex");
  const actual = Buffer.from(candidate, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new PatientAuthError("Incorrect password");
  }
  return rowToAccount(row);
}

export function createPatientSession(accountId: string): string {
  ensureSchema();
  const token = crypto.randomBytes(32).toString("hex");
  getDb().prepare("INSERT INTO patient_sessions (token, account_id, created_at) VALUES (?, ?, ?)").run(token, accountId, Date.now());
  return token;
}

export function getPatientAccountBySession(token: string): PatientAccount | null {
  ensureSchema();
  const row = getDb()
    .prepare("SELECT a.* FROM patient_sessions s JOIN patient_accounts a ON a.id = s.account_id WHERE s.token = ?")
    .get(token) as { id: string; name: string; email: string; phone: string; patient_id: string } | undefined;
  return row ? rowToAccount(row) : null;
}

export function destroyPatientSession(token: string): void {
  ensureSchema();
  getDb().prepare("DELETE FROM patient_sessions WHERE token = ?").run(token);
}
