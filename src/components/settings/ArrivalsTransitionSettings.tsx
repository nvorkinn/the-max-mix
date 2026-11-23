import flip from '../../assets/settings/arrivals-flip.gif';
import none from '../../assets/settings/arrivals-none.gif';
import sinkRise from '../../assets/settings/arrivals-sink-rise.gif';
import slide from '../../assets/settings/arrivals-slide.gif';
import still from '../../assets/settings/arrivals-still.png';
import { ARRIVALS_TRANSITIONS, saveArrivalsTransition, useArrivalsTransition } from '../../utils/arrivalsTransition';
import type { ArrivalsTransition } from '../../utils/arrivalsTransition';
import { useT } from '../../i18n/translate';
import SettingsSection from './SettingsSection';

/** Each transition as the Dashboard plays it, recorded from a board changing stop three times and back to the first. */
const RECORDINGS: Record<ArrivalsTransition, string> = { flip, slide, sinkRise, none };

/**
 * How a board along the bottom of the Dashboard changes to the next stop: each choice is a panel playing that change on a
 * real board, and tapping a panel picks it. Kept on this tablet (utils/arrivalsTransition), as it only changes how the
 * screen looks. Under reduced motion the panels hold still, as the boards then change without moving.
 */
export default function ArrivalsTransitionSettings() {
  const t = useT();
  const chosen = useArrivalsTransition();
  return (
    <SettingsSection
      id="arrivals-transition-label"
      title={t('countdown.transition')}
      caption={t('countdown.transition_caption')}
    >
      <div className="transition-choices" role="group" aria-labelledby="arrivals-transition-label">
        {ARRIVALS_TRANSITIONS.map(id => (
          <button
            type="button"
            key={id}
            aria-pressed={chosen === id}
            onClick={() => saveArrivalsTransition(id)}
            className="transition-choice"
          >
            <picture className="transition-choice-picture">
              <source media="(prefers-reduced-motion: reduce)" srcSet={still} />
              <img src={RECORDINGS[id]} alt="" className="transition-choice-preview" />
            </picture>
            <span className="transition-choice-name">{t(`countdown.transition.${id}`)}</span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}
