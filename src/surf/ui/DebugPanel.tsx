'use client';
import { useEffect, useState } from 'react';
import { bumpConfig, SURF_CONFIG } from '../config';
import { DEBUG_PARAMS, getConfigPath, setConfigPath } from '../game/debugParams';
import styles from './surf.module.css';

export interface DebugTarget {
  configChanged(): void;
  setGizmo(visible: boolean): void;
}

/** ?debug — live sliders for SURF_CONFIG plus fps / draw calls / triangles. */
export function DebugPanel({ game }: { game: DebugTarget }) {
  const [, force] = useState(0);
  const [gizmo, setGizmo] = useState(true);
  const [stats, setStats] = useState('');
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = window.__surf;
      if (s) setStats(`${s.fps} fps · ${s.calls} calls · ${s.triangles.toLocaleString('en-US')} tris · x ${s.x.toFixed(1)} · ${s.mode}`);
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className={styles.debug} data-testid="debug-panel">
      <div>{stats}</div>
      <label style={{ display: 'flex', gap: 6 }}>
        <input
          type="checkbox"
          checked={gizmo}
          onChange={(e) => {
            setGizmo(e.target.checked);
            game.setGizmo(e.target.checked);
          }}
        />
        wave-frame gizmo
      </label>
      {DEBUG_PARAMS.map(([path, min, max, step]) => {
        const value = getConfigPath(SURF_CONFIG, path);
        return (
          <label key={path}>
            <span>{path}</span>
            <span>{value.toFixed(3)}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => {
                setConfigPath(SURF_CONFIG, path, Number(e.target.value));
                bumpConfig();
                game.configChanged();
                force((n) => n + 1);
              }}
            />
          </label>
        );
      })}
    </div>
  );
}
