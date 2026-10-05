interface Props {
  speeds: number[];
  speed: number;
  live: boolean;
  onSpeed: (speed: number) => void;
  onNow: () => void;
}

// Simulation speed buttons plus "Now". Shown over the globe on desktop and in the sheet on phones.
export default function TimeControls({ speeds, speed, live, onSpeed, onNow }: Props) {
  return (
    <div className="gg-buttons" role="group" aria-label="Time speed">
      {speeds.map(s => (
        <button key={s} className={s === speed ? 'active' : ''} aria-pressed={s === speed} onClick={() => onSpeed(s)}>×{s}</button>
      ))}
      <button onClick={onNow} disabled={live}>Now</button>
    </div>
  );
}
