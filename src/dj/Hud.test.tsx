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
});
