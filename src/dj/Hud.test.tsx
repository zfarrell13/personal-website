// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Hud } from './Hud';
import { useDjStore } from './store/djStore';

beforeEach(() => useDjStore.getState().reset());
afterEach(cleanup);

describe('Hud keyboard', () => {
  it('holding Shift sets SHIFT once (auto-repeat and unchanged state are no-ops)', () => {
    render(<Hud />);
    let updates = 0;
    const off = useDjStore.subscribe(() => updates++);
    fireEvent.keyDown(window, { key: 'Shift' });
    fireEvent.keyDown(window, { key: 'Shift', repeat: true });
    fireEvent.keyDown(window, { key: 'Shift', repeat: true });
    expect(useDjStore.getState().ui.shift).toBe(true);
    expect(updates).toBe(1);
    fireEvent.keyUp(window, { key: 'Shift' });
    fireEvent.blur(window); // already released: no store write
    expect(useDjStore.getState().ui.shift).toBe(false);
    expect(updates).toBe(2);
    off();
  });

  it('Tab switches the view and is not passed on to the browser', () => {
    render(<Hud />);
    const before = useDjStore.getState().ui.view;
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(useDjStore.getState().ui.view).not.toBe(before);
    expect(ev.defaultPrevented).toBe(true);
  });

  it.each(['select', 'input', 'textarea'])('Tab inside a %s keeps its normal focus behaviour', (tag) => {
    render(<Hud />);
    const el = document.createElement(tag);
    document.body.appendChild(el);
    const before = useDjStore.getState().ui.view;
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(useDjStore.getState().ui.view).toBe(before);
    expect(ev.defaultPrevented).toBe(false);
    el.remove();
  });
});
