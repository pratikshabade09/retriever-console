export function Badge({ tone, children }: { tone?: "good" | "warn" | "bad" | "accent"; children: React.ReactNode }) {
  return <span className={`badge${tone ? ` badge-${tone}` : ""}`}>{children}</span>;
}
