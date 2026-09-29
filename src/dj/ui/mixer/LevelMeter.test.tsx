// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DjProvider, type DjRuntime } from '../../DjContext';
import { createTelemetry } from '../../engine/telemetry';
import { FrameLoop } from '../../frameLoop';
import { LevelMeter } from './LevelMeter';

afterEach(cleanup);

function setup() {
  const loop = new FrameLoop();
  const telemetry = createTelemetry();
  render(
    <DjProvider value={{ loop, telemetry } as unknown as DjRuntime}>
      <LevelMeter label="Master level" read={[(t) => t.levels.master[0], (t) => t.levels.master[1]]} />
    </DjProvider>,
  );
  let now = 0;
  const frame = () => act(() => loop.step((now += 1000 / 60)));
  const lit = () =>
    Array.from(screen.getByRole('img', { name: 'Master level' }).children).map((col) => Array.from(col.children).filter((s) => (s as HTMLElement).dataset.on === 'true').length);
  return { telemetry, frame, lit };
}

describe('<LevelMeter>', () => {
  it('renders one 15-segment ladder per reader and lights them per frame', () => {
    const s = setup();
    s.frame();
    expect(s.lit()).toEqual([0, 0]);
    s.telemetry.levels.master = [1, 10 ** (-14.9 / 20)]; // 0 dBFS → full ladder; just above −15 dBFS → up to the 0 dB mark
    s.frame();
    expect(s.lit()).toEqual([15, 11]);
  });

  it('keeps the peak segment lit after the level drops, and treats a non-finite level as silence', () => {
    const s = setup();
    s.telemetry.levels.master = [1, 1];
    s.frame();
    s.telemetry.levels.master = [Number.NaN, 0];
    s.frame();
    expect(s.lit()).toEqual([1, 1]); // only the held peak segment
  });
});
