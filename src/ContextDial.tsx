import type { OverflowPolicy } from './settings';

/** A little dial for how full the model's context window is. Hover (or focus) it for the numbers and a bar. */
export default function ContextDial({ used, size, overflow }: { used: number; size: number; overflow: OverflowPolicy }) {
  const ratio = Math.min(used / size, 1);
  const percent = Math.round(ratio * 100);
  const level = used > size || ratio >= 0.95 ? 'full' : ratio >= 0.8 ? 'high' : 'ok';
  const radius = 8;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className={`ctx ${level}`} tabIndex={0} role="img" aria-label={`Context window ${percent}% full: ${used} of ${size} tokens`}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle className="ctx-track" cx="11" cy="11" r={radius} />
        <circle
          className="ctx-fill"
          cx="11"
          cy="11"
          r={radius}
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <div className="ctx-pop">
        <div className="ctx-title">Context window</div>
        <div className="ctx-bar">
          <div style={{ width: `${percent}%` }} />
        </div>
        <div className="ctx-numbers">
          <span>
            {used.toLocaleString()} / {size.toLocaleString()} tokens
          </span>
          <span>{percent}%</span>
        </div>
        {level !== 'ok' && (
          <p className="ctx-note">
            {overflow === 'stop'
              ? level === 'full'
                ? 'Full. Nothing more will be sent; start a new chat.'
                : 'Getting full. Past this, nothing more will be sent.'
              : level === 'full'
                ? 'Full. Older messages are left out of what the model sees.'
                : 'Getting full. Past this, older messages are left out.'}
          </p>
        )}
      </div>
    </div>
  );
}
