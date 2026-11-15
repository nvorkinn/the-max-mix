import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { startRegistration } from './countdown/registration';
import App from './App';

vi.mock('./components/TabletView', () => ({
  default: ({ signInError }: { signInError?: string }) => <div>tablet-view {signInError}</div>
}));
vi.mock('./countdown/registration', () => ({ startRegistration: vi.fn(() => Promise.resolve()) }));

describe('App', () => {
  it('renders the tablet view', () => {
    render(<App />);
    expect(screen.getByText('tablet-view')).toBeInTheDocument();
  });

  it('passes a failed sign-in on to the tablet view', () => {
    render(<App signInError="Spotify said no" />);
    expect(screen.getByText('tablet-view Spotify said no')).toBeInTheDocument();
  });

  it('says when the screen belongs to someone else, and tries again', () => {
    render(<App registrationError="taken" />);
    expect(screen.getByText('This screen belongs to someone else.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(startRegistration).toHaveBeenCalled();
  });

  it('closes the registration problem', () => {
    render(<App registrationError="unknown" />);
    expect(screen.getByText('Couldn’t add this screen')).toBeInTheDocument();
    expect(screen.queryByText('This screen belongs to someone else.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Couldn’t add this screen')).not.toBeInTheDocument();
  });
});
