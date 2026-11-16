import { afterEach, describe, expect, it } from 'vitest';
import { loadDashboardLayout, saveDashboardLayout } from './dashboardLayout';

describe('dashboard layout', () => {
  afterEach(() => localStorage.clear());

  it('starts with the notice list, and keeps the one picked', () => {
    expect(loadDashboardLayout()).toBe('list');
    saveDashboardLayout('modular');
    expect(loadDashboardLayout()).toBe('modular');
    saveDashboardLayout('list');
    expect(localStorage.getItem('maxmix.dashboardLayout')).toBeNull();
  });

  it('ignores a layout it does not know', () => {
    localStorage.setItem('maxmix.dashboardLayout', 'sideways');
    expect(loadDashboardLayout()).toBe('list');
  });
});
