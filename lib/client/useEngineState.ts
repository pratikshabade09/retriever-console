"use client";

import { useEffect, useState } from "react";
import { fetchState, type StateResponse } from "./api";

/** Polls the server snapshot. Each tick is a fresh read — this is not locally-mutated domain
 * state, just the last poll's response, which is why holding it in useState is fine here. */
export function useEngineState(pollMs = 1000): StateResponse | null {
  const [data, setData] = useState<StateResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const next = await fetchState();
        if (!cancelled) setData(next);
      } catch {
        // transient fetch failure — the next poll retries
      }
    }
    poll();
    const id = setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  return data;
}
