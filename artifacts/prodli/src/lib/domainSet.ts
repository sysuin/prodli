// Excluded sites in the Time Tracker: "google.com" also covers mail.google.com
// and docs.google.com. A Set, so the views' `excluded.has(domain)` checks keep working.

export class DomainSet extends Set<string> {
  constructor(domains: Iterable<string> = []) {
    super([...domains].map((d) => d.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean));
  }
  has(domain: string): boolean {
    const d = domain.toLowerCase();
    if (super.has(d)) return true;
    for (const x of this) if (d.endsWith(`.${x}`)) return true;
    return false;
  }
}
