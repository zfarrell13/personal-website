/** Mode icons: a wave for light mode (surf) and a music note for dark mode (DJ). Stroke/fill come from CSS. */
export function WaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden>
      <path d="M3 22c3 0 4-3 7-3s4 3 7 3 4-3 7-3 4 3 5 3" />
      <path d="M5 17c0-7 6-12 13-11-4 2-5 6-3 9 1.5 2.2 4.5 2.4 6 1" />
    </svg>
  );
}

export function NoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden>
      <path d="M12 23V7l14-3v16" />
      <circle cx="8.5" cy="23.5" r="3.5" />
      <circle cx="22.5" cy="20.5" r="3.5" />
    </svg>
  );
}
