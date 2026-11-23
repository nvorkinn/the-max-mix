import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '../../test/user';
import { loadArrivalsTransition, saveArrivalsTransition } from '../../utils/arrivalsTransition';
import AppearanceSettings from './AppearanceSettings';

describe('AppearanceSettings', () => {
  afterEach(() => {
    saveArrivalsTransition('slide');
  });

  it("picks how the Dashboard's arrivals change stop, Slide until another is picked, and keeps it", async () => {
    render(<AppearanceSettings themeColour="forest" onThemeColourChange={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Arrivals transition' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Slide' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Sink and rise' }));
    expect(screen.getByRole('button', { name: 'Sink and rise' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Slide' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('maxmix.arrivalsTransition')).toBe('sinkRise');
    expect(loadArrivalsTransition()).toBe('sinkRise');
    expect(screen.getByRole('button', { name: 'Flip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'None' })).toBeInTheDocument();
  });

  it('picks a colour, shown on a sample of the player', async () => {
    const onThemeColourChange = vi.fn();
    render(<AppearanceSettings themeColour="forest" onThemeColourChange={onThemeColourChange} />);
    expect(screen.getByRole('button', { name: 'Forest' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Your colour')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Navy' }));
    expect(onThemeColourChange).toHaveBeenCalledExactlyOnceWith('navy');
  });

  it("shows the album art's colours beside the chosen one while Dynamic is on", async () => {
    const onDynamicColourChange = vi.fn();
    const { rerender } = render(
      <AppearanceSettings
        themeColour="teal"
        onThemeColourChange={vi.fn()}
        dynamicColour={false}
        onDynamicColourChange={onDynamicColourChange}
      />
    );
    expect(screen.queryByText('While music plays')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Dynamic' }));
    expect(onDynamicColourChange).toHaveBeenCalledExactlyOnceWith(true);

    rerender(
      <AppearanceSettings
        themeColour="teal"
        onThemeColourChange={vi.fn()}
        dynamicColour
        onDynamicColourChange={onDynamicColourChange}
      />
    );
    expect(screen.getByText('Your colour, when nothing plays')).toBeInTheDocument();
    expect(screen.getByText('While music plays')).toBeInTheDocument();
  });
});
