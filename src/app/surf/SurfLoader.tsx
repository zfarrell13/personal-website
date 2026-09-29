'use client';
import dynamic from 'next/dynamic';
import { LoadingScreen } from '@/retro/ui/LoadingScreen';
import { RotateDevice } from '@/retro/ui/RotateDevice';
import { SupportGate } from '@/retro/ui/SupportGate';

const SurfApp = dynamic(() => import('@/surf/SurfApp'), {
  ssr: false,
  loading: () => <LoadingScreen label="Paddling out" />,
});

export default function SurfLoader() {
  return (
    <SupportGate needs={['webgl2']}>
      <SurfApp />
      <RotateDevice />
    </SupportGate>
  );
}
