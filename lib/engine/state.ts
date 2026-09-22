// The engine's state shape and its initial (empty-clinic) value. Lives in its own module so
// reducer.ts, decide.ts, capacity.ts, queue.ts, opd.ts and money.ts can all reference
// EngineState without importing each other.

import type {
  Appointment,
  CapacityLedgerRow,
  CapacityPolicyConfig,
  Charge,
  Doctor,
  DoctorSession,
  FeeConfigRow,
  Investigation,
  Invoice,
  NotificationRow,
  OpdChangeRow,
  Patient,
  QueueEntry,
  Service,
  SessionTemplate,
  Slot,
  Visit,
  WalkInRatePoint,
} from "./types";
import { DOCTORS, INITIAL_FEES, SERVICES, SESSION_TEMPLATES, WALK_IN_RATES, DEFAULT_POLICY } from "./seed";

export interface EngineState {
  doctors: Record<string, Doctor>;
  services: Record<string, Service>;
  sessionTemplates: Record<string, SessionTemplate>;
  sessions: Record<string, DoctorSession>;
  slots: Record<string, Slot>;
  patients: Record<string, Patient>;
  appointments: Record<string, Appointment>;
  visits: Record<string, Visit>;
  queueEntries: Record<string, QueueEntry>;
  investigations: Record<string, Investigation>;
  charges: Record<string, Charge>;
  invoices: Record<string, Invoice>;
  capacityLedger: CapacityLedgerRow[];
  notifications: NotificationRow[];
  opdChanges: OpdChangeRow[];
  feeHistory: FeeConfigRow[];
  walkInRates: WalkInRatePoint[];
  policy: CapacityPolicyConfig;
  ewmaConsultMinutes: Record<string, number>;
}

function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) out[row.id] = row;
  return out;
}

export function createInitialState(): EngineState {
  return {
    doctors: byId(DOCTORS),
    services: byId(SERVICES),
    sessionTemplates: byId(SESSION_TEMPLATES),
    sessions: {},
    slots: {},
    patients: {},
    appointments: {},
    visits: {},
    queueEntries: {},
    investigations: {},
    charges: {},
    invoices: {},
    capacityLedger: [],
    notifications: [],
    opdChanges: [],
    feeHistory: [...INITIAL_FEES],
    walkInRates: [...WALK_IN_RATES],
    policy: { ...DEFAULT_POLICY },
    ewmaConsultMinutes: {},
  };
}
