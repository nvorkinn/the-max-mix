import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({
  default: ({ isSettingUp }: { isSettingUp: boolean }) => <p>{isSettingUp ? 'the setup' : 'the app'}</p>
}));
vi.mock('./countdown/registration', () => ({
  needsSetup: vi.fn(() => false)
}));

describe('main', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders the app', async () => {
    await import('./main');
    expect(await screen.findByText('the app')).toBeInTheDocument();
  });

  it('starts the setup wizard on a kiosk that has not been through it', async () => {
    const registration = await import('./countdown/registration');
    vi.mocked(registration.needsSetup).mockReturnValueOnce(true);
    await import('./main');
    expect(await screen.findByText('the setup')).toBeInTheDocument();
  });
});
