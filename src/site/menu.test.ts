import { describe, expect, it } from 'vitest';
import { DEFAULT_INDEX, MENU, moveIndex } from './menu';

describe('title menu', () => {
  it('lists the five sections in order, with their routes', () => {
    expect(MENU.map((m) => [m.id, m.label, m.href])).toEqual([
      ['surf', 'FREE SURF', '/surf'],
      ['profile', 'RIDER PROFILE', '/profile'],
      ['career', 'CAREER MODE', '/career'],
      ['trophies', 'TROPHY ROOM', '/trophies'],
      ['credits', 'CREDITS', '/credits'],
    ]);
  });

  it('starts on FREE SURF', () => {
    expect(MENU[DEFAULT_INDEX]!.id).toBe('surf');
  });

  it('moveIndex steps and wraps both ways', () => {
    expect(moveIndex(0, 1)).toBe(1);
    expect(moveIndex(3, -1)).toBe(2);
    expect(moveIndex(MENU.length - 1, 1)).toBe(0);
    expect(moveIndex(0, -1)).toBe(MENU.length - 1);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
  });
});
