// Authorization is checked before decide() runs, in its own table — never by hiding a UI
// button. decide() also independently enforces the couple of rules exercised by the engine's
// own test suite (reception/tier-2, reception/clinical actions, admin-only reconfiguration);
// this table is the fuller, HTTP-boundary version of the same policy, defense in depth.

import type { Command } from "@/lib/engine/commands";
import { UnauthorizedCommand } from "@/lib/engine/errors";

const RECEPTION_CANNOT: ReadonlySet<Command["type"]> = new Set([
  "StartConsultation",
  "CompleteConsultation",
  "StartReview",
  "CompleteReview",
  "OrderInvestigation",
  "RecordInvestigationResult",
  "SetFollowUp",
]);

const ADMIN_ONLY: ReadonlySet<Command["type"]> = new Set([
  "RegisterDoctor",
  "ReconfigureSession",
  "ChangeFeeConfig",
  "ChangePolicyConfig",
]);

export function authorize(command: Command): void {
  if (command.actorRole === "RECEPTION" && RECEPTION_CANNOT.has(command.type)) {
    throw new UnauthorizedCommand(`Reception cannot perform ${command.type}`);
  }
  if (ADMIN_ONLY.has(command.type) && command.actorRole !== "ADMIN") {
    throw new UnauthorizedCommand(`Only admin can perform ${command.type}`);
  }
  if (command.type === "EscalatePriority" && command.tier === 2 && command.actorRole === "RECEPTION") {
    throw new UnauthorizedCommand("Reception cannot issue a tier-2 clinical escalation");
  }
}
