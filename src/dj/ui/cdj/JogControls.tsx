'use client';
import { DEFAULT_MOTOR_SEC, type DeckId } from '../../constants';
import { useDjStore } from '../../store/djStore';
import { Knob } from '../controls/Knob';
import { LED, LedButton } from '../controls/LedButton';

/** VINYL SPEED ADJ knob ↔ seconds: 0..1 → 0..2 s (quadratic, default 0.15 s). */
export const motorKnobToSec = (k: number): number => 2 * k * k;
export const motorSecToKnob = (s: number): number => Math.sqrt(Math.max(0, s) / 2);

/** JOG MODE (VINYL / NORMAL — the hardware's name for the latter is a trademark), VINYL SPEED ADJ (TOUCH / RELEASE) and JOG ADJUST (platter weight). */
export function JogControls({ deck }: { deck: DeckId }) {
  const vinylMode = useDjStore((s) => s.decks[deck].vinylMode);
  const motorStopSec = useDjStore((s) => s.decks[deck].motorStopSec);
  const motorStartSec = useDjStore((s) => s.decks[deck].motorStartSec);
  const jogWeight = useDjStore((s) => s.decks[deck].jogWeight);
  const setDeck = useDjStore((s) => s.setDeck);
  return (
    <>
      <LedButton label="JOG MODE" led={LED.blue} lit={vinylMode} toggle onPress={() => setDeck(deck, { vinylMode: !vinylMode })} testId={`jogmode-${deck}`}>
        {vinylMode ? 'VINYL' : 'NORMAL'}
      </LedButton>
      <Knob label="TOUCH" size={34} value={motorSecToKnob(motorStopSec)} defaultValue={motorSecToKnob(DEFAULT_MOTOR_SEC)} detent={null} onChange={(k) => setDeck(deck, { motorStopSec: motorKnobToSec(k) })} />
      <Knob label="RELEASE" size={34} value={motorSecToKnob(motorStartSec)} defaultValue={motorSecToKnob(DEFAULT_MOTOR_SEC)} detent={null} onChange={(k) => setDeck(deck, { motorStartSec: motorKnobToSec(k) })} />
      <Knob label="JOG ADJ" size={34} value={jogWeight} defaultValue={0.5} onChange={(v) => setDeck(deck, { jogWeight: v })} />
    </>
  );
}
