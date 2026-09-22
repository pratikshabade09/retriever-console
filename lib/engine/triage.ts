// Deterministic keyword -> specialty routing for the patient bot's "I don't know which
// doctor" path. No LLM: a fixed, auditable map, checked in order.

import type { Doctor } from "./types";

const RULES: { keywords: string[]; specialty: string; rationale: string }[] = [
  { keywords: ["hair", "scalp", "dandruff", "skin", "rash", "acne", "itch", "allergy"], specialty: "Dermatologist", rationale: "Skin and hair concerns are seen by a dermatologist." },
  { keywords: ["heart", "chest pain", "palpitation", "blood pressure", "bp", "cardiac"], specialty: "Cardiologist", rationale: "Heart and chest symptoms are seen by a cardiologist." },
  { keywords: ["fever", "cold", "cough", "body ache", "checkup", "general", "stomach", "headache"], specialty: "General Physician", rationale: "General symptoms are best started with a general physician." },
];

const DEFAULT_SPECIALTY = "General Physician";

export interface TriageResult {
  specialty: string;
  suggestedDoctorId: string | null;
  rationale: string;
}

export function triage(symptom: string, doctors: Doctor[]): TriageResult {
  const lower = symptom.toLowerCase();
  const rule = RULES.find((r) => r.keywords.some((k) => lower.includes(k)));
  const specialty = rule?.specialty ?? DEFAULT_SPECIALTY;
  const rationale = rule?.rationale ?? "When in doubt, a general physician can direct you further.";
  const doctor = doctors.find((d) => d.specialty === specialty);
  return { specialty, suggestedDoctorId: doctor?.id ?? null, rationale };
}
