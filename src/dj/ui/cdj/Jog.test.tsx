// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DjProvider, type DjRuntime } from '../../DjContext';
import { FrameLoop } from '../../frameLoop';
import { Jog } from './Jog';
import { TOP_PLATE_FRACTION } from './jogMath';

function setup() {
  const jog = vi.fn();
  const loop = new FrameLoop();
  const display = () => ({ jog: document.createElement('canvas'), touched: false });
  const displays = [display(), display()] as const;
  const runtime = { actions: { jog }, loop, displays } as unknown as DjRuntime;
  const view = render(
    <DjProvider value={runtime}>
      <Jog deck={1} />
    </DjProvider>,
  );
  const el = screen.getByTestId('jog-1');
  let now = 0;
  const frame = () => act(() => loop.step((now += 1000 / 60)));
  return { jog, el, displays, frame, view };
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Touch the top plate and turn it a little, so the engine is holding a non-zero velocity. */
function grabAndTurn({ el, frame }: ReturnType<typeof setup>) {
  fireEvent.pointerDown(el, { pointerId: 5, clientX: 150, clientY: 100 });
  fireEvent.pointerMove(el, { pointerId: 5, clientX: 100, clientY: 150 });
  frame();
}

describe('<Jog> release paths', () => {
  it('mounts the deck jog canvas and marks the platter touched while held', () => {
    const s = setup();
    expect(s.el.querySelector('canvas')).toBe(s.displays[1].jog);
    grabAndTurn(s);
    expect(s.displays[1].touched).toBe(true);
    const [deck, touch, v, ring] = s.jog.mock.calls.at(-1)!;
    expect([deck, touch, ring]).toEqual([1, true, false]);
    expect(v).toBeGreaterThan(0);
  });

  it.each([
    ['pointerup', (el: HTMLElement) => fireEvent.pointerUp(el, { pointerId: 5 })],
    ['pointercancel', (el: HTMLElement) => fireEvent.pointerCancel(el, { pointerId: 5 })],
    ['lostpointercapture', (el: HTMLElement) => fireEvent.lostPointerCapture(el, { pointerId: 5 })],
    ['window blur', () => fireEvent.blur(window)],
  ])('%s sends a final zero-velocity, untouched jog message', (_name, release) => {
    const s = setup();
    grabAndTurn(s);
    release(s.el);
    expect(s.jog.mock.calls.at(-1)).toEqual([1, false, 0, false]);
    expect(s.displays[1].touched).toBe(false);
    s.jog.mockClear();
    s.frame();
    expect(s.jog).not.toHaveBeenCalled();
  });

  it('unmount sends a final zero-velocity message', () => {
    const s = setup();
    grabAndTurn(s);
    s.view.unmount();
    expect(s.jog.mock.calls.at(-1)).toEqual([1, false, 0, false]);
  });

  it('a pointer held still for more than ~50 ms reports zero velocity', () => {
    const s = setup();
    grabAndTurn(s);
    for (let i = 0; i < 4; i++) s.frame();
    expect(s.jog.mock.calls.at(-1)).toEqual([1, true, 0, false]);
  });

  it('another pointer releasing does not end the hold', () => {
    const s = setup();
    grabAndTurn(s);
    fireEvent.pointerUp(s.el, { pointerId: 9 });
    expect(s.displays[1].touched).toBe(true);
    expect(s.jog.mock.calls.at(-1)![1]).toBe(true);
  });
});

describe('<Jog> geometry', () => {
  it('reads the layout once per press, not on every pointer move', () => {
    const s = setup();
    const rect = vi.mocked(Element.prototype.getBoundingClientRect);
    rect.mockClear();
    fireEvent.pointerDown(s.el, { pointerId: 5, clientX: 150, clientY: 100 });
    for (let i = 0; i < 5; i++) fireEvent.pointerMove(s.el, { pointerId: 5, clientX: 150 - i * 10, clientY: 100 + i * 10 });
    expect(rect).toHaveBeenCalledTimes(1);
  });

  it('draws the top plate edge exactly where the hit test switches from plate to ring', () => {
    const s = setup();
    expect(s.el.style.getPropertyValue('--plate')).toBe(`${TOP_PLATE_FRACTION * 100}%`);
    // the gradient must be sized to the radius (closest-side), and the plate edge must come from --plate
    const css = readFileSync(join(process.cwd(), 'src/dj/ui/cdj/cdj.module.css'), 'utf8');
    const jogRule = /\.jog\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(jogRule).toMatch(/radial-gradient\(circle closest-side,[^;]*var\(--plate\)/);
  });
});
