import type { Parcels } from 'countdown-api';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ParcelsSettings from './ParcelsSettings';

describe('ParcelsSettings', () => {
  it('has the parcel settings while a Parcel API key is saved', () => {
    render(<ParcelsSettings parcels={{ enabled: true, days_ahead: 1, kept_hours: 4 }} onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Notice board' })).toHaveAccessibleDescription(
      'Your Parcel deliveries on the Dashboard’s notice board.'
    );
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Set up Parcel' })).not.toBeInTheDocument();
  });

  it('reads back each choice in a sentence under its heading', () => {
    const { rerender } = render(
      <ParcelsSettings parcels={{ enabled: true, days_ahead: 1, kept_hours: 4 }} onChange={vi.fn()} />
    );
    const arriving = screen.getByRole('region', { name: 'Arriving by' });
    const kept = screen.getByRole('region', { name: 'Delivered ones stay' });
    expect(arriving).toHaveTextContent('Parcels due today or tomorrow show on the board.');
    expect(kept).toHaveTextContent('A delivered parcel stays on the board for 4 hours.');
    rerender(<ParcelsSettings parcels={{ enabled: true, days_ahead: null, kept_hours: 1 }} onChange={vi.fn()} />);
    expect(arriving).toHaveTextContent('Every parcel on its way shows on the board, whenever it is due.');
    expect(kept).toHaveTextContent('A delivered parcel stays on the board for 1 hour.');
    rerender(<ParcelsSettings parcels={{ enabled: true, days_ahead: 0, kept_hours: 0 }} onChange={vi.fn()} />);
    expect(arriving).toHaveTextContent('Parcels due today show on the board.');
    expect(kept).toHaveTextContent('A parcel leaves the board as soon as it is delivered.');
    // A stay this tablet doesn't know (from a newer server) has no chip pressed and no sentence.
    const newer = { enabled: true, kept_hours: 2 } as unknown as Parcels;
    rerender(<ParcelsSettings parcels={newer} onChange={vi.fn()} />);
    expect(kept).toHaveTextContent(/^Delivered ones stay(Not kept|1 hour|4 hours|A day)+$/);
  });

  it('only says how to set Parcel up while no key is saved', () => {
    render(<ParcelsSettings parcels={{ enabled: true }} keySaved={false} onChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Set up Parcel' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map(step => step.textContent)).toEqual([
      'Get Parcel Premium in the Parcel app',
      'Copy your API key from web.parcelapp.net',
      'Scan the code and paste the key'
    ]);
    expect(screen.queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument();
  });

  it("has a code that opens the settings site's page for the Parcel key", () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.build');
    try {
      render(<ParcelsSettings parcels={{ enabled: false }} keySaved={false} onChange={vi.fn()} />);
      expect(screen.getByRole('img', { name: 'https://countdown.build/account/parcel' })).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
