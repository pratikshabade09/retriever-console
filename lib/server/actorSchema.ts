// The HTTP-boundary envelope every staff command must carry. Field-level validation beyond
// the actor envelope is decide()'s job — it already throws a typed domain error for anything
// illegal, and this route layer never contains domain logic of its own.

import { z } from "zod";

export const commandEnvelope = z
  .object({
    type: z.string().min(1),
    actorRole: z.enum(["PATIENT", "RECEPTION", "DOCTOR", "ADMIN", "SYSTEM"]),
    actorId: z.string().min(1),
  })
  .passthrough();
