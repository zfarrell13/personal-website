// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { DjProvider, type DjRuntime } from '../../DjContext';
import { createTelemetry } from '../../engine/telemetry';
import { FrameLoop } from '../../frameLoop';
import { useDjStore } from '../../store/djStore';
import { FxSection } from './FxSection';

beforeEach(() => useDjStore.getState().reset());
afterEach(cleanup);

describe('<FxSection>', () => {
  it('does not re-render while a channel strip is dragged, only when its own values change', () => {
    let renders = 0;
    render(
      <DjProvider value={{ loop: new FrameLoop(), telemetry: createTelemetry() } as unknown as DjRuntime}>
        <Profiler id="fx" onRender={() => renders++}>
          <FxSection />
        </Profiler>
      </DjProvider>,
    );
    const base = renders;
    act(() => {
      for (let k = 1; k <= 10; k++) useDjStore.getState().setChannel(0, { fader: k / 10, color: -k / 10 });
      useDjStore.getState().setMixer({ crossfader: 0.2 });
    });
    expect(renders).toBe(base);
    act(() => useDjStore.getState().setBeatFx({ depth: 0.3 }));
    expect(renders).toBe(base + 1);
    act(() => useDjStore.getState().setMixer({ masterLevel: 0.5 }));
    expect(renders).toBe(base + 2);
  });
});
