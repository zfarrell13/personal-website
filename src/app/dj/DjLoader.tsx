'use client';
import dynamic from 'next/dynamic';
import { LoadingScreen } from '@/retro/ui/LoadingScreen';
import { RotateDevice } from '@/retro/ui/RotateDevice';
import { SupportGate } from '@/retro/ui/SupportGate';

const DjApp = dynamic(() => import('@/dj/DjApp'), {
  ssr: false,
  loading: () => <LoadingScreen label="Soundcheck" />,
});

export default function DjLoader() {
  return (
    <SupportGate needs={['webgl2', 'audioWorklet']}>
      <DjApp />
      <RotateDevice />
    </SupportGate>
  );
}
