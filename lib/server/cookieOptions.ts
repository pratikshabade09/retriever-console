// Shared cookie options for both auth systems (staff and patient). `secure` is on whenever
// the app is actually running in production — most deployment platforms terminate TLS in
// front of the Node process, but the cookie itself must still be marked secure so browsers
// refuse to send it over a plaintext connection.

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function sessionCookieOptions(maxAge: number = THIRTY_DAYS) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function clearedCookieOptions() {
  return sessionCookieOptions(0);
}
