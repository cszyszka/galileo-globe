import { describe, expect, it } from 'vitest';
import { parseGalileoStatus, safeGscUrl } from './galileo-status.js';

const row = href => `<table class="table table-striped"><tbody>
  <tr><td>GSAT0101</td><td>E11</td><td>PHM</td><td>USABLE</td><td><a href="${href}">2026001</a></td><td>GENERAL</td><td>Info</td></tr>
</tbody></table>`;

describe('safeGscUrl', () => {
  it('keeps https links on the GSC site, resolving relative ones', () => {
    expect(safeGscUrl('/notice-advisory-to-galileo-users-nagu-2026001')).toBe('https://www.gsc-europa.eu/notice-advisory-to-galileo-users-nagu-2026001');
    expect(safeGscUrl('https://www.gsc-europa.eu/a?x=1&amp;y=2')).toBe('https://www.gsc-europa.eu/a?x=1&y=2');
  });

  it('drops other schemes and other hosts', () => {
    expect(safeGscUrl('javascript:alert(1)')).toBeNull();
    expect(safeGscUrl('data:text/html,hi')).toBeNull();
    expect(safeGscUrl('http://www.gsc-europa.eu/a')).toBeNull();
    expect(safeGscUrl('https://evil.example/a')).toBeNull();
    expect(safeGscUrl('https://gsc-europa.eu.evil.example/a')).toBeNull();
  });
});

describe('parseGalileoStatus', () => {
  it('keeps a safe notice link', () => {
    const sats = parseGalileoStatus(row('/nagu/2026001'));
    expect(sats.GSAT0101.nagu.url).toBe('https://www.gsc-europa.eu/nagu/2026001');
  });

  it('drops an unsafe notice link but keeps the notice', () => {
    const sats = parseGalileoStatus(row('javascript:alert(1)'));
    expect(sats.GSAT0101.nagu).toMatchObject({ id: '2026001', url: null });
  });
});
