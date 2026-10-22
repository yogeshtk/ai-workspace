// Station search used by both the server API and the offline client list.

export interface Station {
  crs: string;
  name: string;
}

/** Rank: exact CRS, name prefix, word prefix, substring. */
export function searchStations(query: string, list: Station[], limit = 10): Station[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { s: Station; score: number }[] = [];
  for (const s of list) {
    const name = s.name.toLowerCase();
    let score = -1;
    if (s.crs.toLowerCase() === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(/[\s\-()]+/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push({ s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.name.length - b.s.name.length || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((x) => x.s);
}
