'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { typingInField } from '@/shared/input/backKey';
import { moveIndex } from './menu';
import { menuMove, menuSelect } from './sfx';
import { useBackToMenu } from './useBackToMenu';
import styles from './sections/sections.module.css';

const FOCUSABLE = 'a[href], button:not([disabled])';

/** How far ↑↓ scroll a section with nothing to select (RIDER PROFILE). */
const SCROLL_STEP = 48;

/** The section's focusable items in page order, or only the open dialog's while one is open. */
function items(root: HTMLElement): HTMLElement[] {
  const scope = root.querySelector<HTMLElement>('dialog[open]') ?? root;
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
}

/**
 * Shared chrome for the section pages: "◀ MENU" and the section title on a bar, the content on an opaque
 * panel that scrolls on its own (the page body doesn't scroll), and a key-hint strip on desktop, where the
 * NOW PLAYING tag sits (bottom-right) so it never covers content. On phones the tag sits top-right, in the bar.
 * Keys: ↑↓ move focus through the section's links and buttons (wrapping, with the menu blip), or scroll a
 * section that has none; Enter opens the focused one; Esc/Backspace go back to the menu (unless an open dialog
 * used the key first). The content area takes focus on arrival, so the keyboard (and a screen reader) start
 * there and PageDown/Space scroll it.
 */
export function SectionScreen({ title, children }: { title: string; children: React.ReactNode }) {
  useBackToMenu();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    // Tells the NOW PLAYING tag it may use the room beside ◀ MENU (globals.css --np-max).
    document.documentElement.dataset.screen = 'section';
    return () => {
      delete document.documentElement.dataset.screen;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typingInField(e.target)) return;
      const main = mainRef.current;
      if (!main) return;
      const list = items(main);
      const down = e.key === 'ArrowDown';
      if (list.length === 0) {
        // Nothing to select: the arrows scroll. The browser does that itself when focus is inside the content.
        if (main.contains(document.activeElement)) return;
        e.preventDefault();
        main.scrollBy({ top: down ? SCROLL_STEP : -SCROLL_STEP });
        return;
      }
      e.preventDefault();
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
          <span className={styles.backArrow} aria-hidden="true">
            ◀
          </span>
          MENU
        </Link>
        <h1 className={styles.heading}>{title}</h1>
      </header>
      <main ref={mainRef} className={styles.body} tabIndex={-1} onClick={onClick}>
        <div className={styles.panel}>{children}</div>
      </main>
      <p className={styles.hints} aria-hidden="true">
        ↑↓ SELECT · ENTER OPEN · ESC MENU
      </p>
    </div>
  );
}
