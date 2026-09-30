'use client';
import { RotateDevice } from '@/retro/ui/RotateDevice';
import { SupportGate } from '@/retro/ui/SupportGate';

/** The game itself lives in the site Stage (src/site/Stage.tsx), which plays on this route. */
export default function SurfLoader() {
  return (
    <SupportGate needs={['webgl2']}>
      <RotateDevice />
    </SupportGate>
  );
}
