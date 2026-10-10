export type PanelTab = 'satellites' | 'settings';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'satellites', label: 'Satellites' },
  { id: 'settings', label: 'Settings' },
];

// Keys that move between tabs, and where they go.
const KEY_TARGETS: Record<string, PanelTab> = { ArrowLeft: 'satellites', ArrowRight: 'settings', Home: 'satellites', End: 'settings' };

// The panel's tab buttons. They control the single tabpanel with id "gg-tabpanel".
// Standard tabs keyboard pattern: one Tab stop, arrow keys (and Home/End) switch tabs.
export default function PanelTabs({ tab, onPick }: { tab: PanelTab; onPick: (tab: PanelTab) => void }) {
  return (
    <div
      className="gg-tabs"
      role="tablist"
      aria-label="Panel"
      onKeyDown={e => {
        const next = KEY_TARGETS[e.key];
        if (!next) return;
        e.preventDefault();
        onPick(next);
        document.getElementById(`gg-tab-${next}`)?.focus();
      }}
    >
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          role="tab"
          id={`gg-tab-${id}`}
          aria-selected={tab === id}
          aria-controls="gg-tabpanel"
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onPick(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
