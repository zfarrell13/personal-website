'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** True when a key press belongs to a text field (Backspace deletes, Esc may clear it). */
export function typingInField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
  );
}

/** Esc or Backspace goes back to the title menu (`/`), except while typing in a field. */
export function useBackToMenu(): void {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Escape' && e.key !== 'Backspace') || e.repeat || e.defaultPrevented) return;
      if (typingInField(e.target) || typingInField(document.activeElement)) return;
      e.preventDefault();
      router.push('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
}
