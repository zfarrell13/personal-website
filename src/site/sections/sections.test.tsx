// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { site } from '@/content/site';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
// Plain elements: next/link needs the app router's context and next/image the image config, neither mounted here.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, width, height, className }: { src: string; alt: string; width: number; height: number; className?: string }) => (
    <img src={src} alt={alt} width={width} height={height} className={className} />
  ),
}));
const sfx = vi.hoisted(() => ({ menuMove: vi.fn(), menuSelect: vi.fn() }));
vi.mock('@/site/sfx', () => sfx);

const ProfilePage = await import('@/app/profile/page');
const CareerPage = await import('@/app/career/page');
const TrophiesPage = await import('@/app/trophies/page');
const CreditsPage = await import('@/app/credits/page');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const key = (k: string, target: Element | null = document.activeElement) => fireEvent.keyDown(target ?? window, { key: k, bubbles: true });
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

describe('section pages', () => {
  it.each([
    [ProfilePage, 'Rider Profile — Zach Farrell'],
    [CareerPage, 'Career Mode — Zach Farrell'],
    [TrophiesPage, 'Trophy Room — Zach Farrell'],
    [CreditsPage, 'Credits — Zach Farrell'],
  ])('exports its page title (%#)', (page, title) => {
    expect(page.metadata.title).toBe(title);
  });
});

describe('SectionScreen chrome', () => {
  it('has ◀ MENU back to /, Esc goes to the menu, ↑↓ move focus through the items with a blip', () => {
    render(<CreditsPage.default />);
    expect(screen.getByRole('link', { name: '◀ MENU' }).getAttribute('href')).toBe('/');
    const main = screen.getByRole('main');
    const items = within(main).getAllByRole('link').filter((a) => a.textContent !== '◀ MENU');
    key('ArrowDown', document.body);
    expect(document.activeElement).toBe(items[0]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key('ArrowUp');
    expect(document.activeElement).toBe(items[0]);
    expect(sfx.menuMove).toHaveBeenCalledTimes(3);
    key('Escape');
    expect(nav.push).toHaveBeenCalledWith('/');
  });
});

describe('RIDER PROFILE', () => {
  it('shows the player card and one meter per stat', () => {
    render(<ProfilePage.default />);
    expect(heading()).toBe('RIDER PROFILE');
    const p = site.profile;
    expect(screen.getByRole('heading', { level: 2, name: p.name })).toBeTruthy();
    for (const text of [p.title, p.location, p.tagline, p.lookingFor, ...p.bio]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByRole('img', { name: `Photo of ${p.name}` }).getAttribute('src')).toBe(p.photo);
    const meters = screen.getAllByRole('meter');
    expect(meters).toHaveLength(p.stats.length);
    expect(meters[0]!.getAttribute('aria-label')).toBe(p.stats[0]!.label);
    expect(Number(meters[0]!.getAttribute('aria-valuenow'))).toBeCloseTo(p.stats[0]!.value / 10);
  });
});

describe('CAREER MODE', () => {
  it('offers the resume PDF and lists seasons newest first, the newest open', () => {
    render(<CareerPage.default />);
    expect(heading()).toBe('CAREER MODE');
    expect(screen.getByRole('link', { name: /DOWNLOAD RESUME/ }).getAttribute('href')).toBe(site.career.resumePdf);
    const rows = screen.getAllByRole('button');
    const newest = [...site.career.seasons].sort((a, b) => b.start.localeCompare(a.start));
    expect(rows.map((r) => r.textContent)).toEqual(newest.map((s) => expect.stringContaining(s.role)));
    expect(rows.map((r) => r.getAttribute('aria-expanded'))).toEqual(newest.map((_, i) => String(i === 0)));
    expect(screen.getByText(newest[0]!.wins[0]!)).toBeTruthy();
  });

  it('expands a season on Enter and collapses it on the next', () => {
    render(<CareerPage.default />);
    const newest = [...site.career.seasons].sort((a, b) => b.start.localeCompare(a.start));
    const row = screen.getAllByRole('button')[1]!;
    expect(screen.queryByText(newest[1]!.wins[0]!)).toBeNull();
    row.focus();
    key('Enter');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(row.getAttribute('aria-controls')!)!;
    for (const w of newest[1]!.wins) expect(within(panel).getByText(w)).toBeTruthy();
    expect(sfx.menuSelect).toHaveBeenCalledTimes(1);
    key('Enter');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(newest[1]!.wins[0]!)).toBeNull();
  });
});

describe('TROPHY ROOM', () => {
  it('shows a card per trophy with its links; the surf game first', () => {
    render(<TrophiesPage.default />);
    expect(heading()).toBe('TROPHY ROOM');
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(site.trophies.length);
    expect(within(cards[0]!).getByText('Kelly-style Surf Game')).toBeTruthy();
    expect(within(cards[0]!).getByRole('link', { name: /PLAY/ }).getAttribute('href')).toBe('/surf');
  });

  it('opens the detail dialog; the first Esc closes it (focus back on the card), the next goes to the menu', () => {
    render(<TrophiesPage.default />);
    const [surf] = site.trophies;
    const open = within(screen.getAllByRole('article')[0]!).getByRole('button');
    open.focus();
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: surf!.name });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    for (const para of surf!.story) expect(within(dialog).getByText(para)).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);

    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(open);

    key('Escape');
    expect(nav.push).toHaveBeenCalledWith('/');
  });

  it('keeps ↑↓ inside the open dialog', () => {
    render(<TrophiesPage.default />);
    fireEvent.click(within(screen.getAllByRole('article')[0]!).getByRole('button'));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) {
      key('ArrowDown');
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('CREDITS', () => {
  it('rolls the contact, links, resume, soundtrack and built-with lines', () => {
    render(<CreditsPage.default />);
    expect(heading()).toBe('CREDITS');
    const { credits, career } = site;
    expect(screen.getByRole('link', { name: credits.email }).getAttribute('href')).toBe(`mailto:${credits.email}`);
    for (const l of credits.links) expect(screen.getByRole('link', { name: l.label }).getAttribute('href')).toBe(l.href);
    expect(screen.getByRole('link', { name: /RESUME/ }).getAttribute('href')).toBe(career.resumePdf);
    expect(screen.getByRole('heading', { name: 'SOUNDTRACK' })).toBeTruthy();
    for (const t of credits.music) {
      expect(screen.getByText(t.title)).toBeTruthy();
      expect(screen.getByText(t.artist)).toBeTruthy();
    }
    expect(screen.getByRole('heading', { name: 'BUILT WITH' })).toBeTruthy();
  });
});
