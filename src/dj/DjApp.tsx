'use client';
import ModeSwitch from '@/shared/ModeSwitch';
import { Panel } from '@/retro/ui/Panel';

export default function DjApp() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#0b0a2e' }}>
      <Panel title="DJ BOOTH">Soundcheck — under construction.</Panel>
      <ModeSwitch current="dark" />
    </div>
  );
}
