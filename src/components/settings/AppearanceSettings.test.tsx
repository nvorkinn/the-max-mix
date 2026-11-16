import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppearanceSettings from './AppearanceSettings';

describe('AppearanceSettings', () => {
  it('picks how the Dashboard is laid out', () => {
    const onDashboardLayoutChange = vi.fn();
    render(
      <AppearanceSettings
        theme="day"
        autoTheme={false}
        onThemeChange={vi.fn()}
        themeColour="forest"
        onThemeColourChange={vi.fn()}
        dashboardLayout="list"
        onDashboardLayoutChange={onDashboardLayoutChange}
      />
    );
    const layouts = within(screen.getByRole('group', { name: 'Dashboard' }));
    expect(layouts.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(layouts.getByRole('button', { name: 'Timeline' }));
    expect(onDashboardLayoutChange).toHaveBeenCalledWith('timeline');
  });
});
