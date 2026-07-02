function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function AssetDot({ base, size = 34 }: { base: string; size?: number }) {
  const hue = hashHue(base);
  const label = base.length > 4 ? base.slice(0, 3) : base;
  return (
    <span
      className="asset-dot"
      style={{
        width: size,
        height: size,
        fontSize: size * (label.length > 3 ? 0.26 : 0.3),
        background: `hsl(${hue} 75% 92%)`,
        color: `hsl(${hue} 65% 32%)`,
      }}
    >
      {label}
    </span>
  );
}
