export function StatTile({ value, label, tone }: { value: string | number; label: string; tone?: "good" | "bad" }) {
  return (
    <div className={`tile${tone ? ` tile-${tone}` : ""}`}>
      <div className="tile-value mono">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
