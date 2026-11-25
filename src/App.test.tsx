import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

vi.mock('./components/TabletView', () => ({
  default: () => <div>tablet-view</div>
}));
vi.mock('./components/setup/SetupWizard', () => ({
  default: () => <div>setup-wizard</div>
}));

describe('App', () => {
  it('renders the tablet view', () => {
    render(<App />);
    expect(screen.getByText('tablet-view')).toBeInTheDocument();
    expect(screen.queryByText('setup-wizard')).not.toBeInTheDocument();
  });

  it('shows only the setup wizard while the kiosk is being set up', () => {
    render(<App isSettingUp />);
    expect(screen.getByText('setup-wizard')).toBeInTheDocument();
    expect(screen.queryByText('tablet-view')).not.toBeInTheDocument();
  });
});
