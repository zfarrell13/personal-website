'use client';
import ModeSwitch from '@/shared/ModeSwitch';
import { Panel } from '@/retro/ui/Panel';

export default function SurfApp() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#4fb6ff' }}>
      <Panel title="SURF">Paddling out — under construction.</Panel>
      <ModeSwitch current="light" />
    </div>
  );
}
