import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./components/TabletView.jsx', () => ({ default: () => <div>tablet-view</div> }));

import App from './App.jsx';

describe('App', () => {
  it('renders the tablet view', () => {
    render(<App />);
    expect(screen.getByText('tablet-view')).toBeInTheDocument();
  });
});
