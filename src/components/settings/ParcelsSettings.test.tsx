import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ParcelsSettings from './ParcelsSettings';

describe('ParcelsSettings', () => {
  it('has the parcel settings while a Parcel API key is saved', () => {
    render(<ParcelsSettings parcels={{ enabled: true, days_ahead: 1, kept_hours: 4 }} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Set up Parcel' })).not.toBeInTheDocument();
  });

  it('only says how to set Parcel up while no key is saved', () => {
    render(<ParcelsSettings parcels={{ enabled: true }} keySaved={false} onChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Set up Parcel' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map(step => step.textContent)).toEqual([
      'Get Parcel Premium in the Parcel app',
      'Copy your API key from web.parcelapp.net',
      'Scan the code and paste the key under Parcel'
    ]);
    expect(screen.queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument();
  });
});
