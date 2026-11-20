// The problems the tablet has right now, from every part of it, for the warning button in the tab bar. Each part
// reports its own problem while it lasts and takes it back when it is over, so the list never needs closing.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

export interface Problem {
  /** Who reported it, such as "playback"; one problem per id. */
  id: string;
  /** A few words; the whole story stays in the debug console. */
  title: string;
  /** The one button that fixes it, when there is one. */
  action?: { label: string; run: () => void } | undefined;
  /** The fix is running. */
  busy?: boolean | undefined;
}

let problems: readonly Problem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Adds a problem, or replaces the one with the same id where it stands. */
export function reportProblem(problem: Problem): void {
  const index = problems.findIndex(other => other.id === problem.id);
  problems = index === -1 ? [...problems, problem] : problems.map((other, at) => (at === index ? problem : other));
  emit();
}

function clearProblem(id: string): void {
  if (!problems.some(problem => problem.id === id)) return;
  problems = problems.filter(problem => problem.id !== id);
  emit();
}

/** The problems now, oldest first. The same array is returned until something changes. */
export function getProblems(): readonly Problem[] {
  return problems;
}

function subscribeProblems(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forgets every problem (for tests). */
export function clearProblems(): void {
  problems = [];
  emit();
}

export function useProblems(): readonly Problem[] {
  return useSyncExternalStore(subscribeProblems, getProblems);
}

/**
 * Reports `problem` under `id` while it is given, and takes it back once it is null or the caller goes. A new `run`
 * each render doesn't report again: the latest is called.
 */
export function useReportProblem(id: string, problem: Omit<Problem, 'id'> | null): void {
  const runRef = useRef(problem?.action?.run);
  useLayoutEffect(() => {
    runRef.current = problem?.action?.run;
  });
  const title = problem?.title;
  const label = problem?.action?.label;
  const busy = problem?.busy ?? false;
  useEffect(() => {
    if (!title) return;
    reportProblem({ id, title, busy, action: label ? { label, run: () => runRef.current?.() } : undefined });
  }, [id, title, label, busy]);
  useEffect(() => {
    if (!title) clearProblem(id);
  }, [id, title]);
  useEffect(() => () => clearProblem(id), [id]);
}
