import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '../../test/user';
import SettingsToggle from './SettingsToggle';

describe('SettingsToggle', () => {
  it('is a switch named by its heading and described by its caption, which turns on and off', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SettingsToggle id="sample-label" title="Sample" note="What it does." on={false} onChange={onChange} />
    );
    const toggle = screen.getByRole('switch', { name: 'Sample' });
    expect(toggle).toHaveAccessibleDescription('What it does.');
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<SettingsToggle id="sample-label" title="Sample" on onChange={onChange} />);
    expect(toggle).toBeChecked();
    expect(toggle).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('region', { name: 'Sample' })).not.toHaveTextContent('What it does.');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
