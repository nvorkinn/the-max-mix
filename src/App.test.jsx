import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

vi.mock('./components/TabletView', () => ({
  default: (/** @type {{ signInError?: string }} */ { signInError }) => <div>tablet-view {signInError}</div>
}));

describe('App', () => {
  it('renders the tablet view', () => {
    render(<App />);
    expect(screen.getByText('tablet-view')).toBeInTheDocument();
  });

  it('passes a failed sign-in on to the tablet view', () => {
    render(<App signInError="Spotify said no" />);
    expect(screen.getByText('tablet-view Spotify said no')).toBeInTheDocument();
  });
});
