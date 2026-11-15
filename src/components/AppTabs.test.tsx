import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppTabs from './AppTabs';

const TABS = [
  { id: 'spotify', label: 'Spotify', icon: null },
  { id: 'dashboard', label: 'Dashboard', icon: null }
] as const;

describe('AppTabs', () => {
  it('marks the current tab and points each tab at its panel', () => {
    render(<AppTabs tabs={TABS} current="dashboard" onSelect={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Spotify' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Spotify' })).toHaveAttribute('aria-controls', 'app-tab-spotify');
  });

  it('tells the page which tab was tapped', () => {
    const onSelect = vi.fn();
    render(<AppTabs tabs={TABS} current="spotify" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    expect(onSelect).toHaveBeenCalledWith('dashboard');
  });
});
