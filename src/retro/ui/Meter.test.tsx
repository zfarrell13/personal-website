// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Meter } from './Meter';

afterEach(cleanup);

describe('Meter', () => {
  it('lights the right number of segments', () => {
    const { container } = render(<Meter value={0.5} segments={10} label="speed" />);
    expect(container.querySelectorAll('[data-on="true"]').length).toBe(5);
    expect(container.querySelectorAll('[data-on]').length).toBe(10);
  });
  it('clamps out-of-range values', () => {
    const { container } = render(<Meter value={3} segments={4} />);
    expect(container.querySelectorAll('[data-on="true"]').length).toBe(4);
  });
  it('treats NaN as 0', () => {
    const { container } = render(<Meter value={NaN} segments={4} />);
    expect(container.querySelectorAll('[data-on="true"]').length).toBe(0);
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('0');
  });
});
