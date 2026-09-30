'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isBackToMenuKey } from '@/shared/input/backKey';

/** Esc or Backspace goes back to the title menu (`/`); see isBackToMenuKey for what doesn't count. */
export function useBackToMenu(): void {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // defaultPrevented: something on the page already used the key (a dialog closing on Esc).
      if (e.defaultPrevented || !isBackToMenuKey(e)) return;
      e.preventDefault();
      router.push('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
}
