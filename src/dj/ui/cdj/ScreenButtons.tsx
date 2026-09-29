'use client';
import { BEAT_JUMP_SIZES, QUANTIZE_RESOLUTIONS, type DeckId } from '../../constants';
import { useDjStore } from '../../store/djStore';
import { LED, LedButton } from '../controls/LedButton';

/** The next value in a cycle (an unknown value starts the cycle). */
const nextInCycle = (list: readonly number[], v: number): number => list[(list.indexOf(v) + 1) % list.length]!;

/** Quantize resolution as shown on the button: 1, 1/2, 1/4, 1/8 beat. */
const quantizeLabel = (beats: number): string => (beats >= 1 ? '1' : `1/${Math.round(1 / beats)}`);

/** Left of the screen: BROWSE, beat-jump size and quantize resolution (the player's touch-menu settings), SHIFT. */
export function ScreenButtons({ deck }: { deck: DeckId }) {
  const browseOpen = useDjStore((s) => s.decks[deck].browseOpen);
  const beatJumpBeats = useDjStore((s) => s.decks[deck].beatJumpBeats);
  const quantizeBeats = useDjStore((s) => s.decks[deck].quantizeBeats);
  const shift = useDjStore((s) => s.ui.shift);
  const setDeck = useDjStore((s) => s.setDeck);
  const setUi = useDjStore((s) => s.setUi);
  return (
    <>
      <LedButton label="BROWSE" led={LED.white} lit={browseOpen} toggle onPress={() => setDeck(deck, { browseOpen: !browseOpen, pendingLoad: null })} testId={`browse-${deck}`} />
      <LedButton label="BEAT JUMP SIZE" onPress={() => setDeck(deck, { beatJumpBeats: nextInCycle(BEAT_JUMP_SIZES, beatJumpBeats) })} testId={`jumpsize-${deck}`}>
        J{beatJumpBeats}
      </LedButton>
      <LedButton label="QUANTIZE RESOLUTION" onPress={() => setDeck(deck, { quantizeBeats: nextInCycle(QUANTIZE_RESOLUTIONS, quantizeBeats) })} testId={`qres-${deck}`}>
        Q{quantizeLabel(quantizeBeats)}
      </LedButton>
      <LedButton label="SHIFT" led={LED.white} lit={shift} onPress={() => setUi({ shift: true })} onRelease={() => setUi({ shift: false })} testId={`shift-${deck}`} />
    </>
  );
}
