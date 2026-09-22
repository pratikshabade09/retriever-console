// Typed domain errors thrown by decide(). Never swallowed, never crash the process —
// callers surface `.message` to the UI.

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SlotUnavailable extends DomainError {}
export class DuplicateBooking extends DomainError {}
export class InvalidVisitState extends DomainError {}
export class InvestigationAlreadyResulted extends DomainError {}
export class DoctorBusy extends DomainError {}
export class UnauthorizedCommand extends DomainError {}
export class CapacityFloorReached extends DomainError {}
export class SessionNotOpen extends DomainError {}
export class PaymentAlreadyCollected extends DomainError {}
