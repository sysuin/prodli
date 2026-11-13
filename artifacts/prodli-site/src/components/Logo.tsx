// ProdLi's logo: the four-square mark (same as the extension and app icon) next
// to the "ProdLi" wordmark. Kept identical to artifacts/prodli/src/components/Logo.tsx.

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <rect width="128" height="128" fill="#000000" />
      <rect x="4" y="4" width="58" height="58" fill="#FFD700" />
      <rect x="66" y="4" width="58" height="58" fill="#00BCD4" />
      <rect x="4" y="66" width="58" height="58" fill="#FF6B6B" />
      <rect x="66" y="66" width="58" height="58" fill="#66BB6A" />
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3) }}>
      <LogoMark size={size} />
      <span style={{ background: "#FFD700", color: "#000", fontWeight: 900, fontSize: Math.round(size * 0.6), padding: `${Math.round(size * 0.12)}px ${Math.round(size * 0.4)}px`, letterSpacing: "-0.02em", lineHeight: 1.2 }}>ProdLi</span>
    </span>
  );
}
