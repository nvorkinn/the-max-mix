import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

vi.mock('./components/TabletView', () => ({
  default: ({ signInError }: { signInError?: string }) => <div>tablet-view {signInError}</div>
}));
vi.mock('./components/PairingScreen', () => ({
  default: ({ screen: pi }: { screen: { width: number; height: number } }) => (
    <div>
      pairing {pi.width}x{pi.height}
    </div>
  )
}));

describe('App', () => {
  it('renders the tablet view', () => {
    render(<App />);
    expect(screen.getByText('tablet-view')).toBeInTheDocument();
    expect(screen.queryByText(/pairing/)).not.toBeInTheDocument();
  });

  it('passes a failed sign-in on to the tablet view', () => {
    render(<App signInError="Spotify said no" />);
    expect(screen.getByText('tablet-view Spotify said no')).toBeInTheDocument();
  });

  it('covers the tablet view with the pairing QR code while the kiosk has no owner', () => {
    render(<App pairScreen={{ width: 1280, height: 800, brightness_control: false }} />);
    expect(screen.getByText('tablet-view')).toBeInTheDocument();
    expect(screen.getByText('pairing 1280x800')).toBeInTheDocument();
  });
});
