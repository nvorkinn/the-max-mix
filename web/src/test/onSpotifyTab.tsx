import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

/** Renders the tablet, which starts on the Dashboard, then taps over to the Spotify tab. */
export function renderOnSpotifyTab(ui: ReactElement) {
  const view = render(ui);
  fireEvent.click(screen.getByRole('tab', { name: 'Spotify' }));
  return view;
}
