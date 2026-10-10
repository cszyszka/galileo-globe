import { STATUS_COLORS } from '../../lib/satellites';
import type { StatusCounts as Counts } from '../../lib/satellites';
import { MIN_SATS_FOR_FIX } from '../../lib/skyView';
import './StatusSummary.css';

// Small status read-outs used both in the panel and in the collapsed sheet's header.

// A coloured dot; hollow for satellites that aren't usable, matching their markers on the globe.
export function StatusDot({ color, hollow, title }: { color: string; hollow: boolean; title?: string }) {
  return (
    <span
      className={`gg-dot${hollow ? ' gg-hollow' : ''}`}
      style={hollow ? { borderColor: color } : { background: color }}
      title={title}
    />
  );
}

// "● 24 usable  ○ 2 not usable …". `brief` shows only the first two, for the sheet header.
// Returns bare spans so the parent decides the layout.
export function StatusCounts({ counts, brief = false }: { counts: Counts; brief?: boolean }) {
  return (
    <>
      <span><StatusDot color={STATUS_COLORS.ok} hollow={false} /> {counts.ok} usable</span>
      {counts.bad > 0 && <span><StatusDot color={STATUS_COLORS.bad} hollow /> {counts.bad} not usable</span>}
      {!brief && counts.testing > 0 && <span><StatusDot color={STATUS_COLORS.testing} hollow={false} /> {counts.testing} testing</span>}
      {!brief && counts.unknown > 0 && <span><StatusDot color={STATUS_COLORS.unknown} hollow={false} /> {counts.unknown} unlisted</span>}
    </>
  );
}

// " · 6 usable Galileo — enough for a Galileo-only fix", following an "N in view" count.
export function FixSummary({ usable }: { usable: number }) {
  const enough = usable >= MIN_SATS_FOR_FIX;
  return (
    <>
      {' · '}<strong>{usable}</strong> usable Galileo
      <span className={enough ? 'gg-fix-ok' : 'gg-fix-no'}>
        {enough ? ' — enough for a Galileo-only fix' : ` — fewer than ${MIN_SATS_FOR_FIX}, no Galileo-only fix`}
      </span>
    </>
  );
}
