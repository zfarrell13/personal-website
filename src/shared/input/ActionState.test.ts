import { describe, expect, it } from 'vitest';
import { ActionState } from './ActionState';

type A = 'left' | 'right' | 'jump';
const make = () => new ActionState<A>({ left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight'], jump: ['Space'] });

describe('ActionState', () => {
  it('maps keys to actions and reports edges once', () => {
    const s = make();
    expect(s.keyDown('ArrowLeft')).toBe(true);
    s.tick();
    expect(s.isDown('left')).toBe(true);
    expect(s.pressedThisFrame('left')).toBe(true);
    s.tick();
    expect(s.isDown('left')).toBe(true);
    expect(s.pressedThisFrame('left')).toBe(false);
    s.keyUp('ArrowLeft');
    s.tick();
    expect(s.isDown('left')).toBe(false);
    expect(s.releasedThisFrame('left')).toBe(true);
    s.tick();
    expect(s.releasedThisFrame('left')).toBe(false);
  });

  it('ignores unknown keys', () => {
    const s = make();
    expect(s.keyDown('KeyZ')).toBe(false);
  });

  it('keeps an action down while any source holds it', () => {
    const s = make();
    s.keyDown('ArrowLeft');
    s.keyDown('KeyA');
    s.keyUp('ArrowLeft');
    s.tick();
    expect(s.isDown('left')).toBe(true);
    s.keyUp('KeyA');
    s.tick();
    expect(s.isDown('left')).toBe(false);
  });

  it('does not lose a tap that happens between ticks', () => {
    const s = make();
    s.tick();
    s.keyDown('Space');
    s.keyUp('Space');
    s.tick();
    expect(s.pressedThisFrame('jump')).toBe(true);
    expect(s.isDown('jump')).toBe(true);
    s.tick();
    expect(s.pressedThisFrame('jump')).toBe(false);
    expect(s.isDown('jump')).toBe(false);
  });

  it('supports virtual (touch) sources alongside keys', () => {
    const s = make();
    s.press('right', 'touch:1');
    s.keyDown('ArrowRight');
    s.release('right', 'touch:1');
    s.tick();
    expect(s.isDown('right')).toBe(true);
  });

  it('repeated keyDown from the same key does not double count', () => {
    const s = make();
    s.keyDown('ArrowRight');
    s.keyDown('ArrowRight');
    s.tick();
    expect(s.isDown('right')).toBe(true);
    s.keyUp('ArrowRight');
    s.tick();
    expect(s.isDown('right')).toBe(false);
  });

  it('reset releases everything', () => {
    const s = make();
    s.keyDown('ArrowLeft');
    s.tick();
    s.reset();
    s.tick();
    expect(s.isDown('left')).toBe(false);
    expect(s.releasedThisFrame('left')).toBe(true);
  });

  it('reset does not create spurious releases for actions never held', () => {
    const s = make();
    s.reset();
    s.tick();
    expect(s.releasedThisFrame('left')).toBe(false);
    expect(s.releasedThisFrame('right')).toBe(false);
    expect(s.releasedThisFrame('jump')).toBe(false);
  });

  it('attach() wires up keyboard listeners and cleanup detaches them', () => {
    const s = make();
    const listeners = new Map<string, Function[]>();
    const fakeTarget = {
      addEventListener: (event: string, handler: Function) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      },
      removeEventListener: (event: string, handler: Function) => {
        const list = listeners.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx !== -1) list.splice(idx, 1);
        }
      },
    } as any;

    const cleanup = s.attach(fakeTarget);

    // Verify listeners were added
    expect(listeners.has('keydown')).toBe(true);
    expect(listeners.has('keyup')).toBe(true);
    expect(listeners.has('blur')).toBe(true);

    // Dispatch a keydown event for ArrowLeft
    const keydownHandlers = listeners.get('keydown')!;
    const fakeEvent = {
      code: 'ArrowLeft',
      repeat: false,
      preventDefault: () => {},
    } as any;
    keydownHandlers[0](fakeEvent);
    s.tick();
    expect(s.isDown('left')).toBe(true);

    // Call cleanup and verify listeners were removed
    cleanup();
    expect((listeners.get('keydown') || []).length).toBe(0);
    expect((listeners.get('keyup') || []).length).toBe(0);
    expect((listeners.get('blur') || []).length).toBe(0);
  });
});
