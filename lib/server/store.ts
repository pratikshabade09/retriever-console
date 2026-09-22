// The event store. One SQLite file, one table: an append-only log of JSON-encoded events.
// This is the only place in the system that touches disk for domain data.

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Event } from "@/lib/engine/events";

// Configurable so a deployment platform can point this at its persistent volume's mount path
// (e.g. Railway/Render/Fly.io volumes aren't always mounted at the project directory).
const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "clinic.db");

let db: Database.Database | null = null;

/** The shared connection to the clinic's one SQLite file — also used by authStore.ts for the
 * users/sessions tables, so the whole system stays one process, one file. */
export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)");
  return db;
}

export function appendEvents(events: Event[]): void {
  if (events.length === 0) return;
  const database = getDb();
  const insert = database.prepare("INSERT INTO events (payload) VALUES (?)");
  const insertAll = database.transaction((rows: Event[]) => {
    for (const event of rows) insert.run(JSON.stringify(event));
  });
  insertAll(events);
}

export function loadAllEvents(): Event[] {
  const rows = getDb().prepare("SELECT payload FROM events ORDER BY id ASC").all() as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as Event);
}

/** Wipes the event log. Only ever called from dev/test tooling, never from a live route. */
export function resetStore(): void {
  getDb().exec("DELETE FROM events");
}
