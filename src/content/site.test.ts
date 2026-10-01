import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seasonsNewestFirst, site } from './site';
import type { Season } from './types';

/** Every string in the content, with its path ("trophies.1.links.0.href"). */
function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, path ? `${path}.${i}` : `${i}`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

/**
 * Strings that are real or structural rather than placeholder text: the name, file paths, dates, ids, link
 * labels and URLs (a placeholder URL carries SAMPLE inside it instead), the surf game trophy and the soundtrack.
 */
const REAL = [
  /^profile\.(name|title|location|tagline|lookingFor)$/,
  /^profile\.bio\.\d+$/,
  /^profile\.stats\.\d+\.label$/,
  /^profile\.photo$/,
  /^career\.resumePdf$/,
  /^career\.seasons\.\d+\.(start|end|role|company)$/,
  /^career\.seasons\.\d+\.(wins|stack)\.\d+$/,
  /^trophies\.\d+\.(id|image)$/,
  /^trophies\.\d+\.links\.\d+\.(label|href)$/,
  /^trophies\.0\./,
  /^credits\.links\.\d+\.(label|href)$/,
  /^credits\.music\./,
];

describe('site content', () => {
  it('has every section filled in', () => {
    const { profile, career, trophies, credits } = site;
    expect(profile.name).toBe('Zach Farrell');
    for (const s of [profile.title, profile.location, profile.tagline, profile.lookingFor, profile.photo]) expect(s.length).toBeGreaterThan(0);
    expect(profile.bio.length).toBeGreaterThan(0);
    expect(profile.stats.length).toBeGreaterThan(0);
    expect(career.resumePdf).toMatch(/\.pdf$/);
    expect(career.seasons.length).toBeGreaterThan(0);
    for (const s of career.seasons) {
      expect(s.start).toMatch(/^\d{4}-\d{2}$/);
      expect(s.end === 'Present' || /^\d{4}-\d{2}$/.test(s.end)).toBe(true);
      expect(s.wins.length).toBeGreaterThan(0);
    }
    expect(trophies.length).toBeGreaterThan(1);
    expect(new Set(trophies.map((t) => t.id)).size).toBe(trophies.length);
    for (const t of trophies) expect(t.story.length).toBeGreaterThan(0);
    expect(credits.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
    expect(credits.links.length).toBeGreaterThan(0);
  });

  it('keeps stats on the 0..10 scale', () => {
    for (const s of site.profile.stats) {
      expect(Number.isFinite(s.value)).toBe(true);
      expect(s.value).toBeGreaterThanOrEqual(0);
      expect(s.value).toBeLessThanOrEqual(10);
    }
  });

  it('gives every trophy at least one link; the surf game comes first with PLAY → /surf and its code', () => {
    for (const t of site.trophies) expect(t.links.length).toBeGreaterThan(0);
    const [surf] = site.trophies;
    expect(surf!.name).toBe('Kelly-style Surf Game');
    expect(surf!.links).toContainEqual({ label: 'PLAY', href: '/surf' });
    expect(surf!.links).toContainEqual({ label: 'CODE', href: 'https://github.com/zfarrell13/personal-website' });
  });

  it('credits the three real tracks from content/tracks/tracks.json', () => {
    const manifest = JSON.parse(readFileSync('content/tracks/tracks.json', 'utf8')) as { tracks: { title: string; artist: string }[] };
    expect(site.credits.music).toEqual(manifest.tracks.map(({ title, artist }) => ({ title, artist })));
    expect(site.credits.music).toHaveLength(3);
  });

  it('marks every placeholder string with a leading SAMPLE', () => {
    const unmarked = strings(site).filter(([path, s]) => !REAL.some((re) => re.test(path)) && !s.startsWith('SAMPLE'));
    expect(unmarked).toEqual([]);
  });

  it('links only to https:, mailto: or a root-relative path on this site', () => {
    const hrefs = strings(site).filter(([path]) => /(^|\.)href$/.test(path));
    expect(hrefs.length).toBeGreaterThan(0);
    // Root-relative means "/x", not "//host" (protocol-relative, i.e. off-site over whatever scheme the page uses).
    const bad = hrefs.filter(([, href]) => !/^https:\/\/[^/\s]/.test(href) && !/^mailto:[^@\s]+@[^@\s]+$/.test(href) && !/^\/(?!\/)/.test(href));
    expect(bad).toEqual([]);
  });

  it('points file paths at public/', () => {
    const paths = [site.profile.photo, site.career.resumePdf, ...site.trophies.map((t) => t.image)];
    for (const p of paths) expect(() => readFileSync(`public${p}`)).not.toThrow();
  });
});

describe('seasonsNewestFirst', () => {
  const season = (start: string, end: Season['end'] = 'Present'): Season => ({ role: 'r', company: 'c', start, end, wins: ['w'] });

  it('sorts by start, newest first, without touching the input', () => {
    const input = [season('2019-06', '2021-01'), season('2023-02'), season('2021-02', '2023-01')];
    expect(seasonsNewestFirst(input).map((s) => s.start)).toEqual(['2023-02', '2021-02', '2019-06']);
    expect(input.map((s) => s.start)).toEqual(['2019-06', '2023-02', '2021-02']);
  });

  it('defaults to the site seasons', () => {
    const starts = seasonsNewestFirst().map((s) => s.start);
    expect(starts).toEqual([...starts].sort().reverse());
    expect(starts).toHaveLength(site.career.seasons.length);
  });
});
