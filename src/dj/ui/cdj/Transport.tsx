'use client';
import type { DeckId } from '../../constants';
import { useDj, useTel } from '../../DjContext';
import { LED, LedButton } from '../controls/LedButton';

/** CUE + PLAY/PAUSE with CDJ LED behaviour: PLAY blinks while paused, CUE blinks when a press would set a new cue. */
export function Transport({ deck }: { deck: DeckId }) {
  const { actions } = useDj();
  const loaded = useTel((t) => t.decks[deck].loaded);
  const playing = useTel((t) => t.decks[deck].state !== 'PAUSED');
  const atCue = useTel((t) => t.decks[deck].atCue);
  return (
    <>
      <LedButton
        label="CUE"
        shape="round"
        led={LED.orange}
        lit={loaded && (atCue || !playing)}
        blink={loaded && !playing && !atCue ? 'slow' : false}
        onPress={() => actions.cue(deck, true)}
        onRelease={() => actions.cue(deck, false)}
        testId={`cue-${deck}`}
      />
      <LedButton label="PLAY/PAUSE" shape="round" led={LED.green} lit={loaded} blink={loaded && !playing ? 'slow' : false} onPress={() => actions.play(deck)} testId={`play-${deck}`}>
        ▶︎/❚❚
      </LedButton>
    </>
  );
}
