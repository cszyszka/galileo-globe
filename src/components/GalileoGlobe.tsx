import type { CSSProperties } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { LAYERS, SOURCES, countStatuses, healthOf } from '../lib/satellites';
import type { LayerKey } from '../lib/satellites';
import type { Observer } from '../lib/geometry';
import { computeSkyView } from '../lib/skyView';
import type { SkyView } from '../lib/skyView';
import { formatUtc } from '../lib/format';
import { useTheme } from '../lib/theme';
import { useSatelliteData, staleSources } from '../hooks/useSatelliteData';
import { useSimClock } from '../hooks/useSimClock';
import { useReadout } from '../hooks/useReadout';
import { useBottomSheet } from '../hooks/useBottomSheet';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import { useScrollToSelected } from '../hooks/useScrollToSelected';
import { useGeolocation } from '../hooks/useGeolocation';
import { useGlobeScene } from '../globe/useGlobeScene';
import { useGlobePointer } from '../globe/useGlobePointer';
import type { SceneState } from '../globe/scene';
import { ErrorNotice, Legend, LoadingNotice, StaleBanner } from './StageNotices';
import TimeControls from './TimeControls';
import ThemeToggle from './ThemeToggle';
import PanelTabs from './panel/PanelTabs';
import type { PanelTab } from './panel/PanelTabs';
import VisibleFromSection from './panel/VisibleFromSection';
import ServiceStatusSection from './panel/ServiceStatusSection';
import SatelliteGroups from './panel/SatelliteGroups';
import DataCredits from './panel/DataCredits';
import SettingsTab from './panel/SettingsTab';
import { FixSummary, StatusCounts } from './panel/StatusSummary';
import './GalileoGlobe.css';
import './panel/Panel.css';

// The whole app: the globe (stage) and the side panel, which becomes a bottom sheet on phones.
// This component owns the app state and wires it together. The globe is drawn by the d3 scene in
// ../globe, the panel's content by ./panel, and the logic lives in ../lib and ../hooks.

const SPEEDS = [1, 60, 600, 3600];
const SHOW_TIME_KEY = 'gg-show-time';
const TRACE_3D_KEY = 'gg-trace-3d';
// Within this much of the real time, at ×1, the clock counts as live.
const LIVE_TOLERANCE_MS = 2000;
const NO_SKY: SkyView = { aboveHorizon: [], inView: [], usableGalileo: 0 };

export default function GalileoGlobe() {
  const stageRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const { sats, meta, status, retry } = useSatelliteData();
  const { clock, speed, changeSpeed: setClockSpeed } = useSimClock();

  // What is picked: a satellite or a place on the ground (picking on the globe chooses one or the
  // other; picking from a place's own list keeps the place).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [observer, setObserver] = useState<Observer | null>(null);

  // Display settings
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() => Object.fromEntries(LAYERS.map(l => [l.key, true])) as Record<LayerKey, boolean>);
  const [showUnusable, setShowUnusable] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  // People who ask for reduced motion start with the globe still.
  const [autoRotate, setAutoRotate] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [follow, setFollow] = useState(false);
  const [trace3d, setTrace3d] = usePersistentFlag(TRACE_3D_KEY, false);
  const [showTime, setShowTime] = usePersistentFlag(SHOW_TIME_KEY, true);
  const [mask, setMask] = useState(10);
  const { pref: themePref, theme, setPref: setThemePref } = useTheme();

  // The panel starts hidden; picking a satellite or a place reveals it.
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>('satellites');
  const sheet = useBottomSheet(panelRef, headRef);

  const readout = useReadout(sats, clock, observer);

  // The globe
  const visibility = useMemo(() => ({ layers, showUnusable, statusData: status.data }), [layers, showUnusable, status.data]);
  const sceneState = useMemo<SceneState>(
    () => ({ selectedId, showLabels, autoRotate, follow, visibility, observer, mask, trace3d }),
    [selectedId, showLabels, autoRotate, follow, visibility, observer, mask, trace3d],
  );
  const { viewRef, requestRedraw, lookAt, lookAtSat } = useGlobeScene(svgRef, stageRef, sats, sceneState, clock, {
    onSatClick: id => {
      setSelectedId(cur => (cur === id ? null : id));
      setObserver(null); // a satellite or a place, not both
    },
    onPlaceClick: place => {
      setObserver(place);
      setSelectedId(null);
    },
    onEmptyClick: () => setSelectedId(null),
  });
  const pointerHandlers = useGlobePointer(svgRef, viewRef, () => setFollow(false));

  const changeSpeed = (s: number, resetToNow = false) => {
    setClockSpeed(s, resetToNow);
    requestRedraw(); // the satellites jump when the clock resets, even if nothing else moves
  };

  const skipNextScroll = useScrollToSelected(panelRef, selectedId);

  // Picking a satellite clears the chosen place, except when it is picked from that place's own
  // list or sky plot. That list is where the person is looking, so the panel also stays put rather
  // than scrolling to the satellite's details.
  const focusOn = (id: string, keepObserver = false) => {
    setSelectedId(id);
    if (!keepObserver) setObserver(null);
    else if (id !== selectedId) skipNextScroll();
    lookAtSat(id);
    setAutoRotate(false);
  };

  const geolocation = useGeolocation(useCallback((place: Observer) => {
    setObserver(place);
    setSelectedId(null);
    lookAt(place.lon, place.lat);
    setAutoRotate(false);
    setFollow(false);
  }, [lookAt]));

  const pickTab = (t: PanelTab) => {
    setTab(t);
    sheet.expand();
  };

  // Picking something (on the globe or in a list) opens the panel on the satellites tab. This
  // adjusts state during render, React's pattern for reacting to a change without an effect.
  const [prevPick, setPrevPick] = useState({ selectedId, observer });
  if (prevPick.selectedId !== selectedId || prevPick.observer !== observer) {
    setPrevPick({ selectedId, observer });
    const picked = (selectedId !== prevPick.selectedId && selectedId != null) || (observer !== prevPick.observer && observer != null);
    if (picked) {
      setPanelOpen(true);
      pickTab('satellites');
    }
  }

  // Derived data for the panel
  const selected = sats.find(s => s.id === selectedId);
  const layerCounts = useMemo(() => d3.rollup(sats, v => v.length, s => s.layer), [sats]);
  const statusCounts = useMemo(() => countStatuses(sats, status.data), [sats, status.data]);
  const sky = observer ? computeSkyView(sats, readout.bySat, visibility, mask) : NO_SKY;
  const stale = staleSources(meta, status, readout.now);
  const live = speed === 1 && Math.abs(readout.time.getTime() - readout.now) < LIVE_TOLERANCE_MS;

  // Hiding what is selected also deselects it.
  const changeLayer = (key: LayerKey, on: boolean) => {
    setLayers(prev => ({ ...prev, [key]: on }));
    if (!on && selected?.layer === key) setSelectedId(null);
  };
  const changeShowUnusable = (on: boolean) => {
    setShowUnusable(on);
    if (!on && selected && healthOf(selected, status.data).category === 'bad') setSelectedId(null);
  };

  // Shown over the globe on larger screens and in the sheet header on phones (CSS picks one).
  const timeControls = <TimeControls speeds={SPEEDS} speed={speed} live={live} onSpeed={s => changeSpeed(s)} onNow={() => changeSpeed(1, true)} />;

  return (
    <div className={`gg-root${panelOpen ? ' panel-open' : ''}`} style={{ '--gg-sheet-h': panelOpen ? sheet.height : '0px' } as CSSProperties}>
      <main className="gg-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          role="img"
          aria-label="Interactive 3D globe of the Galileo and LEO-PNT satellites. The satellite list in the side panel can be used with a keyboard."
          {...pointerHandlers}
        />
        <div className="gg-overlay">
          <h1>Galileo Constellation</h1>
          <div className="gg-clock">
            {formatUtc(readout.time)}
            {live ? <span className="gg-live">LIVE</span> : <span className="gg-sim">×{speed}</span>}
          </div>
          {Object.entries(meta.sources).map(([key, src]) =>
            src.ok ? null : (
              <div key={key} className="gg-note gg-error">Couldn’t load {SOURCES[key].label} orbit data ({src.message})</div>
            ))}
        </div>
        {meta.status === 'loading' && <LoadingNotice />}
        {meta.status === 'error' && <ErrorNotice onRetry={retry} />}
        <StaleBanner stale={stale} />
        <Legend />
        <ThemeToggle theme={theme} onToggle={() => setThemePref(theme === 'dark' ? 'light' : 'dark')} />
        <button
          className="gg-menu-btn"
          aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
          aria-expanded={panelOpen}
          aria-controls="gg-panel"
          onClick={() => setPanelOpen(open => !open)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" aria-hidden="true">
            <path d="M4.5 5h7M4.5 8h7M4.5 11h7" />
          </svg>
        </button>
        {showTime && (
          <div className="gg-timebar">
            <span className="gg-muted">Time</span>
            {timeControls}
          </div>
        )}
      </main>

      <aside id="gg-panel" className={`gg-panel gg-sheet-${sheet.sheet}${sheet.dragging ? ' dragging' : ''}`} ref={panelRef}>
        <div className="gg-sheet-head" ref={headRef}>
          <button className="gg-grip" aria-label="Resize panel" aria-expanded={sheet.sheet !== 'collapsed'} {...sheet.gripProps} />
          <PanelTabs tab={tab} onPick={pickTab} />
          {showTime && <div className="gg-sheet-time">{timeControls}</div>}
          {/* The collapsed sheet's one-line summary (hidden by CSS once the sheet is open). */}
          <div className="gg-peek">
            {observer ? (
              <>
                <strong>{sky.inView.length}</strong> in view
                {layers.galileo && status.data && <FixSummary usable={sky.usableGalileo} />}
              </>
            ) : status.data ? (
              <StatusCounts counts={statusCounts} brief />
            ) : null}
          </div>
        </div>

        <div className="gg-sheet-body" role="tabpanel" id="gg-tabpanel" aria-labelledby={`gg-tab-${tab}`}>
          {tab === 'satellites' && (
            <>
              <VisibleFromSection
                observer={observer}
                sky={sky}
                mask={mask}
                onMask={setMask}
                status={status}
                galileoShown={layers.galileo}
                selectedId={selectedId}
                onPick={id => focusOn(id, true)}
                onUseMyLocation={geolocation.locate}
                onClear={() => setObserver(null)}
                geoError={geolocation.error}
              />
              <ServiceStatusSection status={status} counts={statusCounts} />
              <SatelliteGroups
                sats={sats}
                visibility={visibility}
                selectedId={selectedId}
                bySat={readout.bySat}
                mask={mask}
                onSelect={id => focusOn(id)}
                onDeselect={() => setSelectedId(null)}
              />
              <DataCredits meta={meta} />
            </>
          )}

          {tab === 'settings' && (
            <SettingsTab
              layers={layers}
              layerCounts={layerCounts}
              onLayerChange={changeLayer}
              showUnusable={status.data ? { value: showUnusable, onChange: changeShowUnusable } : null}
              themePref={themePref}
              onThemePref={setThemePref}
              showTime={{ value: showTime, onChange: setShowTime }}
              trace3d={{ value: trace3d, onChange: setTrace3d }}
              autoRotate={{ value: autoRotate, onChange: setAutoRotate }}
              showLabels={{ value: showLabels, onChange: setShowLabels }}
              follow={{ value: follow, onChange: setFollow, disabled: !selected }}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
