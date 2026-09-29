'use client';
import { HOT_CUE_LABELS, type DeckId } from '../../constants';
import { useDj } from '../../DjContext';
import { useDjStore } from '../../store/djStore';
import { LedButton } from '../controls/LedButton';

/** HOT CUE A–H: empty pad stores (quantized), filled pad jumps; SHIFT + pad clears. Lit in the cue's colour. */
export function HotCuePads({ deck }: { deck: DeckId }) {
  const { actions } = useDj();
  const hotCues = useDjStore((s) => s.decks[deck].hotCues);
  return (
    <>
      {HOT_CUE_LABELS.map((label, i) => (
        <LedButton
          key={label}
          label={`HOT CUE ${label}`}
          shape="pad"
          lit={hotCues[i] !== null}
          led={hotCues[i]?.color ?? '#333'}
          onPress={() => actions.hotCue(deck, i, true)}
          onRelease={() => actions.hotCue(deck, i, false)}
          testId={`hotcue-${deck}-${label}`}
        >
          {label}
        </LedButton>
      ))}
    </>
  );
}
