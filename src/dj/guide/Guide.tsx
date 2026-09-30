'use client';
import { useEffect, useRef, useState } from 'react';
import { browserStorage } from '@/shared/mode';
import { useDj } from '../DjContext';
import { useDjStore } from '../store/djStore';
import { GuidePanel } from './GuidePanel';
import { GuideTracker, readGuideInput, type GuideView } from './guideLogic';
import { rememberGuide, shouldAutoOpen } from './guidePrefs';
import { HIGHLIGHT_CSS, Highlighter } from './highlight';

/** Live readouts (BPM, offset ms, hold) re-render at most this often; step/target changes render at once. */
const LIVE_UPDATE_SEC = 0.1;

/** The phone layout's horizontal panel scroller (absent on the desktop layout). */
const phonePanels = () => document.querySelector<HTMLElement>('[data-testid="booth-panels"]');

function scrollToPanel(p: 0 | 1 | 2) {
  const el = phonePanels();
  if (el) el.scrollTo({ left: p * el.clientWidth, behavior: 'smooth' });
}

/** Clearance kept above/below a revealed control (the page dots sit at the bottom edge). */
const REVEAL_TOP = 12;
const REVEAL_BOTTOM = 36;

/**
 * Phone layout: switch to panel `p` and scroll it vertically (each panel is taller than a landscape
 * phone) until the first highlighted control in it is on screen.
 */
function revealOnPhone(p: 0 | 1 | 2, ids: readonly string[]) {
  const panels = phonePanels();
  if (!panels) return;
  if (useDjStore.getState().ui.mobilePanel !== p) scrollToPanel(p);
  const slot = panels.children[p];
  if (!(slot instanceof HTMLElement)) return;
  const el = ids.map((id) => slot.querySelector(`[data-testid="${id}"]`)).find((e) => e !== null);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const s = slot.getBoundingClientRect();
  if (r.top < s.top + REVEAL_TOP) slot.scrollBy({ top: r.top - s.top - REVEAL_TOP, behavior: 'smooth' });
  else if (r.bottom > s.bottom - REVEAL_BOTTOM) slot.scrollBy({ top: Math.min(r.bottom - s.bottom + REVEAL_BOTTOM, r.top - s.top - REVEAL_TOP), behavior: 'smooth' });
}

/**
 * The step-by-step guide: follows the store/telemetry every frame, lights up the controls for the
 * current step, and on the phone layout brings the panel that holds them into view (never mid-drag).
 * Opens by itself on the first visit; hidden in the room view.
 */
export function Guide() {
  const { telemetry, loop, engine, tracks } = useDj();
  const open = useDjStore((s) => s.ui.guideOpen);
  const roomView = useDjStore((s) => s.ui.view === 'room');
  const mobilePanel = useDjStore((s) => s.ui.mobilePanel);
  const [tracker] = useState(() => new GuideTracker());
  const [view, setView] = useState<GuideView | null>(null);
  const [phone, setPhone] = useState(false);
  const active = open && !roomView;
  const doneSaved = useRef(false);

  useEffect(() => {
    if (shouldAutoOpen(browserStorage(), window.location.search)) useDjStore.getState().setUi({ guideOpen: true });
  }, []);

  // Reopening starts from the first step still to do.
  useEffect(() => {
    if (open) tracker.restart();
  }, [open, tracker]);

  useEffect(() => {
    if (!active) return;
    const bpmById = new Map(tracks.map((t) => [t.id, t.bpm]));
    const trackBpm = (id: string | null) => (id === null ? 0 : (bpmById.get(id) ?? 0));
    const hl = new Highlighter(document);
    // Pointers held on the booth: a panel switch waits until the finger lifts.
    const pointers = new Set<number>();
    const down = (e: PointerEvent) => pointers.add(e.pointerId);
    const up = (e: PointerEvent) => pointers.delete(e.pointerId);
    const blur = () => pointers.clear(); // a release outside the window must not block reveals forever
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', blur);
    let revealed = '';
    let lastStructure = '';
    let lastLive = '';
    let lastPush = -Infinity;
    const off = loop.add((_dt, now) => {
      const v = tracker.update(readGuideInput(useDjStore.getState(), telemetry, engine.nowFrame(), trackBpm), now);
      hl.set(v.targets);
      const structure = `${v.step}|${v.targets.join()}|${v.panel}|${v.bpm?.dir}|${v.offset?.dir}`;
      const live = `${v.hint}|${v.bpm?.deck1}|${v.bpm?.deck2}|${v.offset ? Math.round(v.offset.ms) : ''}`;
      if (structure !== lastStructure || (live !== lastLive && now - lastPush >= LIVE_UPDATE_SEC)) {
        lastStructure = structure;
        lastLive = live;
        lastPush = now;
        setView(v);
      }
      setPhone(phonePanels() !== null);
      const reveal = `${v.panel}|${v.targets.join()}`;
      if (reveal !== revealed && pointers.size === 0) {
        revealed = reveal;
        revealOnPhone(v.panel, v.targets);
      }
      if (v.done && !doneSaved.current) {
        doneSaved.current = true;
        rememberGuide(browserStorage(), 'done');
      }
    });
    return () => {
      off();
      hl.clear();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', blur);
    };
  }, [active, tracker, loop, telemetry, engine, tracks]);

  if (!active || !view) return null;
  const close = () => {
    useDjStore.getState().setUi({ guideOpen: false });
    if (!doneSaved.current) rememberGuide(browserStorage(), 'dismissed');
  };
  return (
    <>
      <style>{HIGHLIGHT_CSS}</style>
      <GuidePanel
        view={view}
        onBack={() => tracker.back()}
        onSkip={() => tracker.skip()}
        onClose={close}
        goPanel={phone && mobilePanel !== view.panel ? view.panel : null}
        onGoPanel={scrollToPanel}
      />
    </>
  );
}
