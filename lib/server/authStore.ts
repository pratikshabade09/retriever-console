// Staff accounts and sessions. Deliberately separate from the event-sourced clinical domain —
// who can log in isn't a clinic event, it's infrastructure — but it lives in the same one
// SQLite file as the event log (see store.ts's getDb()).
//
// Passwords are hashed with Node's built-in scrypt (no new dependency): a random salt per
// user, a timing-safe comparison on verify.

import crypto from "node:crypto";
import { getDb } from "./store";
import type { ActorRole } from "@/lib/engine/types";

export type StaffRole = Extract<ActorRole, "RECEPTION" | "DOCTOR" | "ADMIN">;

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  doctorId: string | null;
}

let initialized = false;
function ensureSchema(): void {
  if (initialized) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL,
      doctor_id TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  initialized = true;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function rowToUser(row: { id: string; name: string; email: string; role: string; doctor_id: string | null }): StaffUser {
  return { id: row.id, name: row.name, email: row.email, role: row.role as StaffRole, doctorId: row.doctor_id };
}

export class AuthError extends Error {}

export function registerUser(params: { name: string; email: string; password: string; role: StaffRole; doctorId: string | null }): StaffUser {
  ensureSchema();
  const email = params.email.trim().toLowerCase();
  if (!params.name.trim()) throw new AuthError("Name is required");
  if (!email.includes("@")) throw new AuthError("A valid email is required");
  if (params.password.length < 8) throw new AuthError("Password must be at least 8 characters");
  if (params.role === "DOCTOR" && !params.doctorId) throw new AuthError("Select which doctor this account belongs to");

  const existing = getDb().prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) throw new AuthError("An account with that email already exists");

  const id = `user-${crypto.randomUUID()}`;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(params.password, salt);
  getDb()
    .prepare("INSERT INTO users (id, name, email, password_hash, password_salt, role, doctor_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, params.name.trim(), email, hash, salt, params.role, params.doctorId);

  return { id, name: params.name.trim(), email, role: params.role, doctorId: params.doctorId };
}

export function verifyLogin(email: string, password: string): StaffUser {
  ensureSchema();
  const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as
    | { id: string; name: string; email: string; password_hash: string; password_salt: string; role: string; doctor_id: string | null }
    | undefined;
  if (!row) throw new AuthError("No account with that email");

  const candidate = hashPassword(password, row.password_salt);
  const expected = Buffer.from(row.password_hash, "hex");
  const actual = Buffer.from(candidate, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new AuthError("Incorrect password");
  }
  return rowToUser(row);
}

export function createSession(userId: string): string {
  ensureSchema();
  const token = crypto.randomBytes(32).toString("hex");
  getDb().prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, Date.now());
  return token;
}

export function getUserBySession(token: string): StaffUser | null {
  ensureSchema();
  const row = getDb()
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?")
    .get(token) as { id: string; name: string; email: string; role: string; doctor_id: string | null } | undefined;
  return row ? rowToUser(row) : null;
}

export function destroySession(token: string): void {
  ensureSchema();
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
