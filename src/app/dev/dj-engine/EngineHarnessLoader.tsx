'use client';
import dynamic from 'next/dynamic';

const EngineHarnessView = dynamic(() => import('@/dj/dev/EngineHarnessView'), { ssr: false });

export default function EngineHarnessLoader() {
  return <EngineHarnessView />;
}
