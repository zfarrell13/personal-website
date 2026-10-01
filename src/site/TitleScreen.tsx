'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { site } from '@/content/site';
import { DEFAULT_INDEX, MENU, moveIndex } from './menu';
import { menuMove, menuSelect } from './sfx';
import styles from './site.module.css';
import { typingInField } from '@/shared/input/backKey';

/**
 * The home page: the PS2 title menu over the dimmed attract wave. One cursor: the selected item is also the
 * focused one, whether it was reached with ↑↓, Tab, the mouse or a tap. Enter/Space start it.
 */
export function TitleScreen() {
  const router = useRouter();
  const [index, setIndex] = useState(DEFAULT_INDEX);
  const indexRef = useRef(index);
  const navRef = useRef<HTMLElement>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);

  const select = (i: number) => {
    if (i === indexRef.current) return;
    indexRef.current = i;
    setIndex(i);
    menuMove();
  };

  // Tells the NOW PLAYING tag the whole top row is free here (globals.css --np-max): phone portrait has room for the name.
  useEffect(() => {
    document.documentElement.dataset.screen = 'home';
    return () => {
      delete document.documentElement.dataset.screen;
    };
  }, []);

  // Follow the selection with focus (this also focuses FREE SURF on mount).
  useEffect(() => {
    const el = links.current[index];
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typingInField(e.target)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        select(moveIndex(indexRef.current, e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter' || e.key === ' ') {
        // A focused control elsewhere (the music tag) keeps its own Enter/Space.
        const focus = document.activeElement;
        if (focus && focus !== document.body && !navRef.current?.contains(focus)) return;
        // Also stops a focused link's native Enter click, so the menu navigates exactly once.
        e.preventDefault();
        if (e.repeat) return;
        menuSelect();
        router.push(MENU[indexRef.current]!.href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <main className={styles.titleScreen}>
      <header className={styles.titleBlock}>
        <h1 className={styles.name}>{site.profile.name.toUpperCase()}</h1>
        <p className={styles.tagline}>{site.homeTagline}</p>
      </header>
      <div className={styles.menuColumn}>
        <nav ref={navRef} className={styles.menuPanel} aria-label="Main menu">
          <ul className={styles.menuList}>
            {MENU.map((item, i) => (
              <li key={item.id}>
                <Link
                  ref={(el) => {
                    links.current[i] = el;
                  }}
                  href={item.href}
                  className={styles.menuItem}
                  data-selected={i === index ? 'true' : undefined}
                  onPointerEnter={() => select(i)}
                  onFocus={() => select(i)}
                  onClick={() => menuSelect()}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className={styles.hint}>↑↓ SELECT · ENTER START</p>
      </div>
    </main>
  );
}
