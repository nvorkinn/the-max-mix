import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '../../test/user';
import type { ClockFormat } from '../../utils/clockFormat';
import { DEFAULT_QUIET_HOURS } from '../../utils/quietHours';
import type { QuietHours } from '../../utils/quietHours';
import ScreenSettings from './ScreenSettings';

describe('ScreenSettings', () => {
  it('sets how soon the screen sleeps, on one bar', async () => {
    const onScreenSleepChange = vi.fn();
    render(<ScreenSettings screenSleep={5} onScreenSleepChange={onScreenSleepChange} clockFormat="24h" />);
    const sleep = screen.getByRole('group', { name: 'Screen sleep' });
    expect(within(sleep).getByRole('button', { name: '5 min' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(sleep).getByRole('button', { name: 'Never' }));
    expect(onScreenSleepChange).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('sets the brightness as the slider moves, on a kiosk whose screen has one to set', () => {
    const onBrightnessChange = vi.fn();
    const { rerender } = render(
      <ScreenSettings
        brightness={80}
        onBrightnessChange={onBrightnessChange}
        screenSleep={5}
        onScreenSleepChange={vi.fn()}
        clockFormat="24h"
      />
    );
    const slider = screen.getByRole('slider', { name: 'Brightness' });
    expect(slider).toHaveValue('80');
    expect(screen.getByText('80%')).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '45' } });
    expect(onBrightnessChange).toHaveBeenCalledExactlyOnceWith(45);

    rerender(<ScreenSettings screenSleep={5} onScreenSleepChange={vi.fn()} clockFormat="24h" />);
    expect(screen.queryByRole('slider', { name: 'Brightness' })).not.toBeInTheDocument();
  });

  describe('quiet hours', () => {
    function setupQuiet({
      hours = DEFAULT_QUIET_HOURS,
      clockFormat = '24h'
    }: { hours?: QuietHours; clockFormat?: ClockFormat } = {}) {
      const onQuietHoursChange = vi.fn();
      render(
        <ScreenSettings
          screenSleep={5}
          onScreenSleepChange={vi.fn()}
          quietHours={hours}
          onQuietHoursChange={onQuietHoursChange}
          clockFormat={clockFormat}
        />
      );
      return onQuietHoursChange;
    }

    it('turn on with the times they had', async () => {
      const onChange = setupQuiet();
      const quiet = screen.getByRole('switch', { name: 'Quiet hours' });
      expect(quiet).not.toBeChecked();
      expect(screen.queryByRole('group', { name: 'From' })).not.toBeInTheDocument();
      await userEvent.click(quiet);
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ on: true, start: 22 * 60, end: 7 * 60 });
    });

    it('turn off and keep their times', async () => {
      const onChange = setupQuiet({ hours: { on: true, start: 23 * 60, end: 6 * 60 } });
      const quiet = screen.getByRole('switch', { name: 'Quiet hours' });
      expect(quiet).toBeChecked();
      await userEvent.click(quiet);
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ on: false, start: 23 * 60, end: 6 * 60 });
    });

    it('move each end by half an hour, in the tablet time format', async () => {
      const onChange = setupQuiet({ hours: { on: true, start: 22 * 60, end: 7 * 60 }, clockFormat: '12h' });
      expect(within(screen.getByRole('group', { name: 'From' })).getByText(/10:00\sPM/)).toBeInTheDocument();
      expect(within(screen.getByRole('group', { name: 'To' })).getByText(/7:00\sAM/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'From later' }));
      expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 22 * 60 + 30, end: 7 * 60 });
      await userEvent.click(screen.getByRole('button', { name: 'To earlier' }));
      expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 22 * 60, end: 6 * 60 + 30 });
    });

    it('never lets both ends meet', async () => {
      const onChange = setupQuiet({ hours: { on: true, start: 6 * 60 + 30, end: 7 * 60 } });
      await userEvent.click(screen.getByRole('button', { name: 'From later' }));
      expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 7 * 60 + 30, end: 7 * 60 });
    });
  });
});
