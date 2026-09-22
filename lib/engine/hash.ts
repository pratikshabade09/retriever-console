// Pure hash for simulated variation (e.g. autopilot consult-duration jitter). No random number
// generator anywhere: the same seed + stableKey always yields the same value, so a scripted
// day replays identically. Not used by decide() itself — only by things that simulate a day.

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic pseudo-random float in [0, 1) from (seed, stableKey). */
export function hashUnit(seed: number, stableKey: string): number {
  const h = fnv1a(`${seed}:${stableKey}`);
  return h / 0xffffffff;
}

/** Deterministic pseudo-random integer in [min, max] inclusive. */
export function hashInt(seed: number, stableKey: string, min: number, max: number): number {
  return min + Math.floor(hashUnit(seed, stableKey) * (max - min + 1));
}
