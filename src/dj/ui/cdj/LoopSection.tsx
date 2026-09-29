'use client';
import type { DeckId } from '../../constants';
import { useDj, useTel } from '../../DjContext';
import { useDjStore } from '../../store/djStore';
import { LED, LedButton } from '../controls/LedButton';
import styles from './cdj.module.css';

/** LOOP IN/OUT, RELOOP/EXIT, 4/8-BEAT, ½X/2X, BEAT JUMP, CALL ◄►, SLIP, QUANTIZE, REVERSE. */
export function LoopSection({ deck }: { deck: DeckId }) {
  const { actions } = useDj();
  const slip = useDjStore((s) => s.decks[deck].slip);
  const quantize = useDjStore((s) => s.decks[deck].quantize);
  const reverse = useDjStore((s) => s.decks[deck].reverse);
  const setDeck = useDjStore((s) => s.setDeck);
  const loopActive = useTel((t) => t.decks[deck].loopActive);
  const loopDefined = useTel((t) => !Number.isNaN(t.decks[deck].loopOutSec));
  const slipRunning = useTel((t) => t.decks[deck].slipFlags !== 0);
  return (
    <>
      <div className={styles.row}>
        <LedButton label="LOOP IN" led={LED.orange} lit={loopActive} onPress={() => actions.loopIn(deck)} testId={`loop-in-${deck}`}>
          IN
        </LedButton>
        <LedButton label="LOOP OUT" led={LED.orange} lit={loopActive} onPress={() => actions.loopOut(deck)} testId={`loop-out-${deck}`}>
          OUT
        </LedButton>
      </div>
      <LedButton label="RELOOP/EXIT" led={LED.orange} lit={loopActive || loopDefined} blink={loopActive ? 'slow' : false} onPress={() => actions.reloop(deck)} testId={`reloop-${deck}`}>
        RELOOP/EXIT
      </LedButton>
      <div className={styles.row}>
        <LedButton label="4 BEAT LOOP" onPress={() => actions.autoLoop(deck, 4)} testId={`loop4-${deck}`}>
          4 BEAT
        </LedButton>
        <LedButton label="8 BEAT LOOP" onPress={() => actions.autoLoop(deck, 8)} testId={`loop8-${deck}`}>
          8 BEAT
        </LedButton>
      </div>
      <div className={styles.row}>
        <LedButton label="LOOP HALF" onPress={() => actions.loopScale(deck, 0.5)}>
          ½X
        </LedButton>
        <LedButton label="LOOP DOUBLE" onPress={() => actions.loopScale(deck, 2)}>
          2X
        </LedButton>
      </div>
      <div className={styles.row}>
        <LedButton label="BEAT JUMP BACK" onPress={() => actions.beatJump(deck, -1)}>
          ◄◄
        </LedButton>
        <LedButton label="BEAT JUMP FORWARD" onPress={() => actions.beatJump(deck, 1)}>
          ►►
        </LedButton>
      </div>
      <div className={styles.row}>
        <LedButton label="CALL PREVIOUS" led={LED.red} onPress={() => actions.call(deck, -1)}>
          CALL◄
        </LedButton>
        <LedButton label="CALL NEXT" led={LED.red} onPress={() => actions.call(deck, 1)}>
          ►
        </LedButton>
      </div>
      <LedButton label="SLIP" led={LED.red} lit={slip} toggle blink={slip && slipRunning ? 'fast' : false} onPress={() => setDeck(deck, { slip: !slip })} testId={`slip-${deck}`} />
      <LedButton label="QUANTIZE" led={LED.red} lit={quantize} toggle onPress={() => setDeck(deck, { quantize: !quantize })} testId={`quantize-${deck}`} />
      <LedButton label="REVERSE" led={LED.red} lit={reverse} toggle onPress={() => setDeck(deck, { reverse: !reverse })} testId={`reverse-${deck}`}>
        REV
      </LedButton>
    </>
  );
}
