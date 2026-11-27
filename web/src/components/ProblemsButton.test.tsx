import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearProblems, getProblems, reportProblem, useReportProblem } from '../problems/problems';
import ProblemsButton from './ProblemsButton';

afterEach(() => {
  act(() => clearProblems());
});

describe('the problems list', () => {
  it('keeps one problem per id, in the order they came', () => {
    reportProblem({ id: 'a', title: 'First' });
    reportProblem({ id: 'b', title: 'Second' });
    reportProblem({ id: 'a', title: 'First again' });
    expect(getProblems().map(problem => problem.title)).toEqual(['First again', 'Second']);
  });

  it('holds a reported problem while it is given and takes it back after', () => {
    const run = vi.fn();
    const initialProps: { title: string | null } = { title: 'Departures not updating' };
    const { rerender, unmount } = renderHook(
      ({ title }) => useReportProblem('feed', title ? { title, action: { label: 'Try again', run } } : null),
      { initialProps }
    );
    expect(getProblems()).toMatchObject([{ id: 'feed', title: 'Departures not updating' }]);
    getProblems()[0]?.action?.run();
    expect(run).toHaveBeenCalledOnce();
    rerender({ title: null });
    expect(getProblems()).toEqual([]);
    rerender({ title: 'Departures not updating' });
    unmount();
    expect(getProblems()).toEqual([]);
  });
});

describe('ProblemsButton', () => {
  it('shows nothing while nothing is wrong', () => {
    render(<ProblemsButton />);
    expect(screen.queryByRole('button', { name: 'Problems' })).not.toBeInTheDocument();
  });

  it('lists what is wrong with its fix, closes on the fix, and offers the details', () => {
    const fix = vi.fn();
    const details = vi.fn();
    render(<ProblemsButton onDetails={details} />);
    act(() =>
      reportProblem({ id: 'playback', title: 'No speaker available', action: { label: 'Choose speaker', run: fix } })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    const sheet = screen.getByRole('dialog', { name: 'Problems' });
    expect(within(sheet).getByText('No speaker available')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Choose speaker' }));
    expect(fix).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Problems' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Problems' })).getByRole('button', { name: 'Details' }));
    expect(details).toHaveBeenCalledOnce();
  });

  it('goes once the last problem does', () => {
    render(<ProblemsButton />);
    act(() => reportProblem({ id: 'x', title: 'Something' }));
    expect(screen.getByRole('button', { name: 'Problems' })).toBeInTheDocument();
    act(() => clearProblems());
    expect(screen.queryByRole('button', { name: 'Problems' })).not.toBeInTheDocument();
  });
});
