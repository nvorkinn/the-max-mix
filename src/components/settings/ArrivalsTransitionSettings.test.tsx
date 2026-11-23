import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '../../test/user';
import { loadArrivalsTransition, saveArrivalsTransition } from '../../utils/arrivalsTransition';
import ArrivalsTransitionSettings from './ArrivalsTransitionSettings';

describe('ArrivalsTransitionSettings', () => {
  afterEach(() => saveArrivalsTransition('slide'));

  it('offers each change of stop as a panel playing it, Slide until another is tapped, and keeps the one tapped', async () => {
    render(<ArrivalsTransitionSettings />);
    const choices = screen.getByRole('group', { name: 'Changing stops' });
    const panels = within(choices).getAllByRole('button');
    expect(panels.map(panel => panel.textContent)).toEqual(['Flip', 'Slide', 'Sink and rise', 'None']);
    // Each panel shows its own recording, named by the words under it.
    expect(panels.map(panel => panel.querySelector('img')?.getAttribute('src'))).toEqual([
      expect.stringMatching(/arrivals-flip/),
      expect.stringMatching(/arrivals-slide/),
      expect.stringMatching(/arrivals-sink-rise/),
      expect.stringMatching(/arrivals-none/)
    ]);
    expect(screen.getByRole('button', { name: 'Slide' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Sink and rise' }));
    expect(screen.getByRole('button', { name: 'Sink and rise' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Slide' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('maxmix.arrivalsTransition')).toBe('sinkRise');
    expect(loadArrivalsTransition()).toBe('sinkRise');
  });

  it('says what it changes', () => {
    render(<ArrivalsTransitionSettings />);
    expect(screen.getByRole('region', { name: 'Changing stops' })).toHaveTextContent(
      'How a board changes to the next stop, when there are more stops than places.'
    );
  });
});
