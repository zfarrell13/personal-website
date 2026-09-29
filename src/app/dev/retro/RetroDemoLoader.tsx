'use client';
import dynamic from 'next/dynamic';

const RetroDemo = dynamic(() => import('@/retro/dev/RetroDemo'), { ssr: false });

export default function RetroDemoLoader() {
  return <RetroDemo />;
}
