// ProdLi's logo: the four-square mark (the same as the extension and app icon)
// next to the "ProdLi" wordmark. Use this everywhere the brand appears.

export const LOGO_COLORS = { yellow: "#FFD700", cyan: "#00BCD4", red: "#FF6B6B", green: "#66BB6A", frame: "#000000" } as const;

/** The four-square mark (identical to extension/icons/icon-*.png, public/icon-*.png, public/favicon.svg and the Meet in-call label). */
export function LogoMark({ size = 24, title }: { size?: number; title?: string }) {
  const c = LOGO_COLORS;
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ display: "block", flexShrink: 0 }}>
      <rect width="128" height="128" fill={c.frame} />
      <rect x="4" y="4" width="58" height="58" fill={c.yellow} />
      <rect x="66" y="4" width="58" height="58" fill={c.cyan} />
      <rect x="4" y="66" width="58" height="58" fill={c.red} />
      <rect x="66" y="66" width="58" height="58" fill={c.green} />
    </svg>
  );
}

/** Mark + wordmark. `compact` shows the mark only (collapsed sidebar). */
export function Logo({ size = 26, compact = false, className }: { size?: number; compact?: boolean; className?: string }) {
  return (
    <span className={`prodli-logo${className ? ` ${className}` : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3) }}>
      <LogoMark size={size} title={compact ? "ProdLi" : undefined} />
      {!compact && <span className="brand-badge">ProdLi</span>}
    </span>
  );
}
