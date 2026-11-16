import { afterEach, describe, expect, it } from 'vitest';
import { loadDashboardLayout, saveDashboardLayout } from './dashboardLayout';

describe('dashboard layout', () => {
  afterEach(() => localStorage.clear());

  it('starts with the notices in a column, and keeps the one picked', () => {
    expect(loadDashboardLayout()).toBe('column');
    saveDashboardLayout('clock');
    expect(loadDashboardLayout()).toBe('clock');
    saveDashboardLayout('column');
    expect(localStorage.getItem('maxmix.dashboardLayout')).toBeNull();
  });

  it('ignores a layout it does not know', () => {
    localStorage.setItem('maxmix.dashboardLayout', 'sideways');
    expect(loadDashboardLayout()).toBe('column');
  });
});
