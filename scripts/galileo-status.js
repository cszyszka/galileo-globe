// Fetches the official Galileo per-satellite status from the European GNSS Service Centre.
// The GSC page doesn't send CORS headers, so this runs server-side, from scripts/refresh-data.js.

export const GSC_URL = 'https://www.gsc-europa.eu/system-service-status/constellation-information';

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function cellText(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, m => ENTITIES[m] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Notice links come from scraped HTML and end up as link targets in the page, so only https
// links on the GSC site are kept (never javascript: or other schemes).
export function safeGscUrl(href) {
  try {
    const url = new URL(href.replace(/&amp;/g, '&'), GSC_URL);
    const host = url.hostname;
    return url.protocol === 'https:' && (host === 'gsc-europa.eu' || host.endsWith('.gsc-europa.eu')) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseGalileoStatus(html) {
  const table = html.match(/<table[^>]*table-striped[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) throw new Error('GSC status table not found');
  const body = table[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? table[1];

  const satellites = {};
  for (const [, row] of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (cells.length < 4) continue;
    const [name, svid, clock, status, nagu, naguType, naguSubject] = cells.map(cellText);
    if (!/^GSAT\d{4}$/.test(name)) continue;
    const href = (cells[4] ?? '').match(/href="([^"]+)"/)?.[1];
    const naguUrl = href ? safeGscUrl(href) : null;
    satellites[name] = {
      svid,
      clock,
      status: status.toUpperCase(),
      nagu: nagu ? { id: nagu, type: naguType || null, subject: naguSubject || null, url: naguUrl } : null,
    };
  }
  if (!Object.keys(satellites).length) throw new Error('No satellites parsed from GSC status table');
  return satellites;
}

export async function fetchGalileoStatus() {
  const res = await fetch(GSC_URL, { headers: { 'user-agent': 'globe-visualization (Galileo status viewer)' } });
  if (!res.ok) throw new Error(`GSC responded ${res.status}`);
  return { source: GSC_URL, fetchedAt: new Date().toISOString(), satellites: parseGalileoStatus(await res.text()) };
}
