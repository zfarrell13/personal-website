// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const dispose = vi.fn(async () => undefined);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/shared/tracks', () => ({ loadManifest: vi.fn(async () => ({ tracks: [] })) }));
vi.mock('./engine/AudioEngine', () => ({
  AudioEngine: { create: vi.fn(async () => ({ dispose, telemetry: { master: -1 }, nowFrame: () => 0, applyState: vi.fn() })) },
}));
vi.mock('./ui/cdj/DeckDisplay', () => ({
  DeckDisplay: class {
    constructor() {
      throw new Error('no 2d context');
    }
  },
}));

import DjApp from './DjApp';

afterEach(cleanup);

describe('DjApp start', () => {
  it('disposes the engine when setup fails after the AudioContext exists (no leak on retry)', async () => {
    render(<DjApp />);
    const start = await screen.findByText('TAP TO START');
    fireEvent.click(start);
    await screen.findByText('no 2d context');
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId('dj-start') as HTMLButtonElement).disabled).toBe(false); // a retry is possible
  });
});
