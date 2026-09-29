'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '@/retro/ui/Panel';
import { RetroButton } from '@/retro/ui/RetroButton';
import { useDj } from '../DjContext';
import { supportsSinkSelection } from '../engine/graph/HeadphoneOutput';
import { useDjStore } from '../store/djStore';
import styles from './booth.module.css';

/** Headphone output device picker (HTMLMediaElement.setSinkId); explains the SPLIT fallback otherwise. */
export function Settings() {
  const { actions } = useDj();
  const sinkId = useDjStore((s) => s.ui.sinkId);
  const setUi = useDjStore((s) => s.setUi);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [supported] = useState(supportsSinkSelection);
  const alive = useRef(false);

  const refresh = useCallback(async () => {
    let outs: MediaDeviceInfo[] = [];
    try {
      outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    } catch {
      // no mediaDevices (insecure context) or enumeration refused: only "Off" is offered
    }
    if (alive.current) setDevices(outs);
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!supported) return () => void (alive.current = false);
    void refresh();
    const md = navigator.mediaDevices;
    const onChange = () => void refresh(); // headphones plugged in / out while the panel is open
    md?.addEventListener?.('devicechange', onChange);
    return () => {
      alive.current = false;
      md?.removeEventListener?.('devicechange', onChange);
    };
  }, [supported, refresh]);

  const unlockNames = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      /* permission refused: device ids still work, names stay generic */
    }
    await refresh();
  };

  return (
    <div className={styles.settings} data-testid="settings">
      <Panel title="SETTINGS">
        <p>HEADPHONES OUTPUT</p>
        {supported ? (
          <>
            <select value={sinkId ?? ''} onChange={(e) => void actions.setHeadphoneDevice(e.target.value || null)} aria-label="Headphones output device">
              <option value="">Off — use SPLIT on the main output</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Output ${i + 1}`}
                </option>
              ))}
            </select>
            {devices.some((d) => !d.label) ? <RetroButton onClick={() => void unlockNames()}>SHOW DEVICE NAMES</RetroButton> : null}
          </>
        ) : (
          <p>This browser can’t pick an output device. Use SPLIT: cue in the left ear, master in the right.</p>
        )}
        <p>
          <RetroButton onClick={() => setUi({ settingsOpen: false })}>CLOSE</RetroButton>
        </p>
      </Panel>
    </div>
  );
}
