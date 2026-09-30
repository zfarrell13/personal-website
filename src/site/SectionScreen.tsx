'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { typingInField } from '@/shared/input/backKey';
import { moveIndex } from './menu';
import { menuMove, menuSelect } from './sfx';
import { useBackToMenu } from './useBackToMenu';
import styles from './sections/sections.module.css';

const FOCUSABLE = 'a[href], button:not([disabled])';

/** The section's focusable items in page order, or only the open dialog's while one is open. */
function items(root: HTMLElement): HTMLElement[] {
  const scope = root.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]') ?? root;
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
}

/**
 * Shared chrome for the section pages: "◀ MENU" and the section title on a bar, the content on an opaque
 * panel that scrolls on its own (the page body doesn't scroll), and a key-hint strip on desktop, where the
 * NOW PLAYING tag sits (bottom-right) so it never covers content. On phones the tag sits top-right, in the bar.
 * Keys: ↑↓ move focus through the section's links and buttons (wrapping, with the menu blip), Enter opens
 * the focused one, Esc/Backspace go back to the menu (unless an open dialog used the key first).
 */
export function SectionScreen({ title, children }: { title: string; children: React.ReactNode }) {
  useBackToMenu();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typingInField(e.target)) return;
      const list = mainRef.current ? items(mainRef.current) : [];
      if (list.length === 0) return; // nothing to move between: the arrows scroll as usual
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = at < 0 ? (down ? 0 : list.length - 1) : moveIndex(at, down ? 1 : -1, list.length);
      list[next]!.focus();
      menuMove();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Following a link is a menu select; buttons play their own sound (they may open or close rather than go).
  const onClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('a[href]')) menuSelect();
  };

  return (
    <div className={styles.screen}>
      <header className={styles.bar}>
        <Link href="/" className={styles.back} onClick={() => menuSelect()}>
          ◀ MENU
        </Link>
        <h1 className={styles.heading}>{title}</h1>
      </header>
      <main ref={mainRef} className={styles.body} onClick={onClick}>
        <div className={styles.panel}>{children}</div>
      </main>
      <p className={styles.hints} aria-hidden="true">
        ↑↓ SELECT · ENTER OPEN · ESC MENU
      </p>
    </div>
  );
}
