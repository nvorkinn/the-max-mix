import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Light, LightsStatus } from '../lights/kiosk';
import LightsView from './LightsView';

const KITCHEN: Light = {
  id: 'light.kitchen',
  name: 'Worktop',
  on: true,
  brightness: 40,
  dimmable: true,
  available: true
};
const KETTLE: Light = {
  id: 'switch.kettle',
  name: 'Kettle',
  on: false,
  brightness: null,
  dimmable: false,
  available: true
};
const ready = (...lights: Light[]): LightsStatus => ({ state: 'ready', lights });

describe('LightsView', () => {
  it('shows each light with its state, and switches it', () => {
    const change = vi.fn();
    render(<LightsView status={ready(KITCHEN, KETTLE)} change={change} signIn={vi.fn()} />);
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    const worktop = screen.getByRole('button', { name: 'Worktop' });
    expect(worktop).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(worktop);
    expect(change).toHaveBeenCalledWith(KITCHEN, { on: false });
    fireEvent.click(screen.getByRole('button', { name: 'Kettle' }));
    expect(change).toHaveBeenLastCalledWith(KETTLE, { on: true });
  });

  it('dims a light that dims, and only that', () => {
    const change = vi.fn();
    render(<LightsView status={ready(KITCHEN, KETTLE)} change={change} signIn={vi.fn()} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAccessibleName('Brightness of Worktop');
    fireEvent.change(slider, { target: { value: '65' } });
    expect(change).toHaveBeenCalledWith(KITCHEN, { brightness: 65 });
  });

  it('leaves a light Home Assistant cannot reach alone', () => {
    render(<LightsView status={ready({ ...KITCHEN, available: false })} change={vi.fn()} signIn={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Worktop' })).toBeDisabled();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('offers the sign-in while the kiosk is signed out', () => {
    const signIn = vi.fn();
    render(<LightsView status={{ state: 'signed-out', lights: [KITCHEN] }} change={vi.fn()} signIn={signIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Home Assistant' }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('says why there are no lights to switch', () => {
    const { rerender } = render(
      <LightsView status={{ state: 'signed-out', lights: [KITCHEN] }} change={vi.fn()} signIn={vi.fn()} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('not signed in to Home Assistant');
    expect(screen.queryByRole('button', { name: 'Worktop' })).not.toBeInTheDocument();
    rerender(<LightsView status={{ state: 'unreachable', lights: [KITCHEN] }} change={vi.fn()} signIn={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('can’t be reached');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<LightsView status={ready()} change={vi.fn()} signIn={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('No lights have been chosen');
    rerender(<LightsView status={null} change={vi.fn()} signIn={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
