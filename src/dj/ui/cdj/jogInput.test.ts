import { describe, expect, it, vi } from 'vitest';
import { JOG_STALL_SEC, JogInput } from './jogInput';

const g = { cx: 100, cy: 100, radius: 100 };
/** Point at `r` (fraction of the radius) and angle `a` (radians, clockwise on screen). */
const at = (r: number, a: number) => [100 + 100 * r * Math.cos(a), 100 + 100 * r * Math.sin(a)] as const;

function setup() {
  const send = vi.fn<(touch: boolean, revPerSec: number, ring: boolean) => void>();
  return { send, jog: new JogInput(send) };
}
const last = (send: ReturnType<typeof setup>['send']) => send.mock.calls.at(-1);

describe('JogInput', () => {
  it('touching the top plate reports a touch at once; turning it reports forward velocity', () => {
    const { send, jog } = setup();
    expect(jog.down(1, ...at(0.5, 0), g)).toBe(true);
    expect(last(send)).toEqual([true, 0, false]);
    expect(jog.touchingTop).toBe(true);
    jog.move(1, ...at(0.5, Math.PI / 2), g); // quarter turn clockwise
    jog.frame(0.25);
    const [touch, v, ring] = last(send)!;
    expect(touch).toBe(true);
    expect(ring).toBe(false);
    expect(v).toBeGreaterThan(0);
  });

  it('the outer ring is a bend (touch false, ring true)', () => {
    const { send, jog } = setup();
    jog.down(1, ...at(0.9, 0), g);
    jog.move(1, ...at(0.9, -0.3), g);
    jog.frame(1 / 60);
    const [touch, v, ring] = last(send)!;
    expect([touch, ring]).toEqual([false, true]);
    expect(v).toBeLessThan(0);
  });

  it('ignores a press outside the wheel and a second finger on the same jog', () => {
    const { send, jog } = setup();
    expect(jog.down(1, ...at(1.2, 0), g)).toBe(false);
    expect(jog.down(2, ...at(0.3, 0), g)).toBe(true);
    expect(jog.down(3, ...at(0.3, 1), g)).toBe(false);
    jog.move(3, ...at(0.3, 2), g); // not the owner: no rotation
    send.mockClear();
    jog.frame(1 / 60);
    expect(last(send)).toEqual([true, 0, false]);
    jog.release(3); // not the owner: still held
    expect(jog.pointer).toBe(2);
  });

  it.each([
    ['pointer up / cancel / lost capture (by id)', (j: JogInput) => j.release(7)],
    ['blur / unmount (whatever is held)', (j: JogInput) => j.release()],
  ])('%s sends a final zero, untouched message immediately', (_name, release) => {
    const { send, jog } = setup();
    jog.down(7, ...at(0.5, 0), g);
    jog.move(7, ...at(0.5, 1), g);
    jog.frame(1 / 60);
    expect(last(send)![1]).not.toBe(0);
    release(jog);
    expect(last(send)).toEqual([false, 0, false]);
    expect(jog.pointer).toBeNull();
    // no more messages after the release (and a second release is a no-op)
    send.mockClear();
    jog.frame(1 / 60);
    jog.release();
    expect(send).not.toHaveBeenCalled();
  });

  it('a held but still pointer reports zero velocity after the stall time', () => {
    const { send, jog } = setup();
    jog.down(1, ...at(0.9, 0), g); // ring: a bend must end when the hand stops
    jog.move(1, ...at(0.9, 0.5), g);
    jog.frame(1 / 60);
    expect(last(send)![1]).toBeGreaterThan(0);
    let t = 0;
    while (t <= JOG_STALL_SEC + 1 / 60) {
      jog.frame(1 / 60);
      t += 1 / 60;
    }
    expect(last(send)).toEqual([false, 0, true]);
  });

  it('a long frame that contains a move is not a stall', () => {
    const { send, jog } = setup();
    jog.down(1, ...at(0.5, 0), g);
    jog.move(1, ...at(0.5, 0.5), g);
    jog.frame(0.1); // > stall time, but the pointer moved during it
    expect(last(send)![1]).toBeGreaterThan(0);
  });

  it('after a stall, turning again resumes without the old velocity', () => {
    const { send, jog } = setup();
    jog.down(1, ...at(0.5, 0), g);
    jog.move(1, ...at(0.5, 1), g);
    jog.frame(1 / 60);
    for (let i = 0; i < 4; i++) jog.frame(1 / 60);
    expect(last(send)![1]).toBe(0);
    jog.move(1, ...at(0.5, 0.99), g); // tiny turn backwards: a leftover forward velocity would win
    jog.frame(1 / 60);
    expect(last(send)![1]).toBeLessThan(0);
  });
});
