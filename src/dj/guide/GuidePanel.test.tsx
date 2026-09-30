// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Highlighter, HIGHLIGHT_ATTR } from './highlight';
import { GuidePanel } from './GuidePanel';
import { GUIDE_STORAGE_KEY, rememberGuide, shouldAutoOpen } from './guidePrefs';
import type { GuideView } from './guideLogic';

afterEach(cleanup);

const view = (p: Partial<GuideView> = {}): GuideView => ({
  step: 1,
  done: false,
  title: 'LOAD A SONG ON DECK 1',
  hint: 'Press BROWSE on deck 1, then tap a song.',
  targets: ['browse-0'],
  panel: 0,
  ...p,
});

function renderPanel(v: GuideView, extra: Partial<React.ComponentProps<typeof GuidePanel>> = {}) {
  const on = { onBack: vi.fn(), onSkip: vi.fn(), onClose: vi.fn() };
  render(<GuidePanel view={v} {...on} {...extra} />);
  return on;
}

describe('<GuidePanel>', () => {
  it('renders the step number, title and hint', () => {
    renderPanel(view());
    expect(screen.getByTestId('guide')).toHaveProperty('dataset.step', '1');
    expect(screen.getByText('1/6')).toBeTruthy();
    expect(screen.getByText('LOAD A SONG ON DECK 1')).toBeTruthy();
    expect(screen.getByTestId('guide-hint').textContent).toBe('Press BROWSE on deck 1, then tap a song.');
  });

  it('Back / Skip / Close call their handlers; Back is disabled on step 1', () => {
    const on = renderPanel(view({ step: 3 }));
    fireEvent.click(screen.getByTestId('guide-back'));
    fireEvent.click(screen.getByTestId('guide-skip'));
    fireEvent.click(screen.getByRole('button', { name: 'Close guide' }));
    expect(on.onBack).toHaveBeenCalledTimes(1);
    expect(on.onSkip).toHaveBeenCalledTimes(1);
    expect(on.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    renderPanel(view({ step: 1 }));
    expect((screen.getByTestId('guide-back') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Skip is disabled on the last step', () => {
    renderPanel(view({ step: 6 }));
    expect((screen.getByTestId('guide-skip') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows both BPMs and the slide direction (step 4)', () => {
    renderPanel(view({ step: 4, bpm: { deck1: '124.0', deck2: '120.0', dir: 'down' } }));
    expect(screen.getByTestId('guide-bpm').textContent).toMatch(/124\.0.*120\.0.*DOWN/);
  });

  it('shows the offset meter with ms and direction (step 5)', () => {
    renderPanel(view({ step: 5, offset: { ms: 34.6, dir: 'back' } }));
    const meter = screen.getByTestId('guide-offset');
    expect(meter.textContent).toMatch(/\+35 ms/);
    expect(meter.textContent).toMatch(/NUDGE BACK/);
  });

  it('finish card: "Mix complete!" without Skip', () => {
    renderPanel(view({ step: 7, done: true, title: 'MIX COMPLETE!', hint: 'Nice.', targets: [] }));
    expect(screen.getByText('MIX COMPLETE!')).toBeTruthy();
    expect(screen.queryByTestId('guide-skip')).toBeNull();
  });

  it('on the phone layout, offers to go to the panel that holds the control', () => {
    const onGoPanel = vi.fn();
    renderPanel(view({ panel: 2 }), { goPanel: 2, onGoPanel });
    fireEvent.click(screen.getByRole('button', { name: /DECK 2/ }));
    expect(onGoPanel).toHaveBeenCalledWith(2);
  });
});

describe('guide prefs', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('auto-opens on the first visit only', () => {
    const s = mem();
    expect(shouldAutoOpen(s, '')).toBe(true);
    rememberGuide(s, 'dismissed');
    expect(s.getItem(GUIDE_STORAGE_KEY)).toBe('dismissed');
    expect(shouldAutoOpen(s, '')).toBe(false);
  });

  it('?guide=off never auto-opens', () => {
    expect(shouldAutoOpen(mem(), '?tracks=test&guide=off')).toBe(false);
  });

  it('works without storage (null or throwing)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(shouldAutoOpen(null, '')).toBe(true);
    expect(shouldAutoOpen(throwing, '')).toBe(true);
    expect(() => rememberGuide(throwing, 'done')).not.toThrow();
  });
});

describe('Highlighter', () => {
  it('marks the target controls, moves with the step and clears', () => {
    document.body.innerHTML = '<button data-testid="browse-0"></button><button data-testid="play-0"></button>';
    const h = new Highlighter(document);
    const el = (id: string) => document.querySelector(`[data-testid="${id}"]`)!;
    h.set(['browse-0']);
    expect(el('browse-0').hasAttribute(HIGHLIGHT_ATTR)).toBe(true);
    h.set(['play-0']);
    expect(el('browse-0').hasAttribute(HIGHLIGHT_ATTR)).toBe(false);
    expect(el('play-0').hasAttribute(HIGHLIGHT_ATTR)).toBe(true);
    h.clear();
    expect(el('play-0').hasAttribute(HIGHLIGHT_ATTR)).toBe(false);
  });

  it('picks up a control that mounts later (refresh)', () => {
    document.body.innerHTML = '';
    const h = new Highlighter(document);
    h.set(['jog-1']);
    document.body.innerHTML = '<div data-testid="jog-1"></div>';
    h.set(['jog-1']);
    expect(document.querySelector('[data-testid="jog-1"]')!.hasAttribute(HIGHLIGHT_ATTR)).toBe(true);
  });
});
