import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { QuietHours } from '../../utils/quietHours';
import QuietHoursTimeline from './QuietHoursTimeline';

/** The timeline with its hours kept as they change, as the Screen page keeps them. */
function Kept({ initial, onChange }: Readonly<{ initial: QuietHours; onChange: (hours: QuietHours) => void }>) {
  const [hours, setHours] = useState(initial);
  return (
    <QuietHoursTimeline
      hours={hours}
      clockFormat="24h"
      onChange={next => {
        setHours(next);
        onChange(next);
      }}
    />
  );
}

function setup(initial: QuietHours) {
  const onChange = vi.fn();
  const { container } = render(<Kept initial={initial} onChange={onChange} />);
  // Each band's start and length, in hours of the day.
  const bands = () =>
    [...container.querySelectorAll<HTMLElement>('.quiet-timeline-band')].map(band =>
      [band.style.left, band.style.width].map(share => Math.round((Number(share.replace('%', '')) / 100) * 24 * 2) / 2)
    );
  return { onChange, bands };
}

const from = () => screen.getByRole('slider', { name: 'From' });
const to = () => screen.getByRole('slider', { name: 'To' });
const press = (handle: HTMLElement, key: string, times = 1) => {
  for (let time = 0; time < times; time += 1) fireEvent.keyDown(handle, { key });
};

describe('QuietHoursTimeline', () => {
  it('steps each end half an hour with the arrow keys, either way and round midnight', () => {
    const { onChange } = setup({ on: true, start: 23 * 60 + 30, end: 7 * 60 });
    expect(from()).toHaveValue(23 * 60 + 30);
    expect(from()).toHaveAttribute('aria-valuetext', '23:30');
    press(from(), 'ArrowUp');
    expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 0, end: 7 * 60 });
    expect(from()).toHaveAttribute('aria-valuetext', '00:00');
    press(from(), 'ArrowDown');
    press(from(), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 23 * 60, end: 7 * 60 });

    press(to(), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 23 * 60, end: 7 * 60 + 30 });
    expect(to()).toHaveAttribute('aria-valuetext', '07:30');
  });

  it('ignores other keys', () => {
    const { onChange } = setup({ on: true, start: 22 * 60, end: 7 * 60 });
    press(from(), 'Enter');
    press(from(), 'a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never lets the ends meet: a step onto the other end jumps over it', () => {
    const { onChange } = setup({ on: true, start: 6 * 60 + 30, end: 7 * 60 });
    press(from(), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 7 * 60 + 30, end: 7 * 60 });
    press(to(), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 7 * 60 + 30, end: 8 * 60 });
    press(to(), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith({ on: true, start: 7 * 60 + 30, end: 7 * 60 });
  });

  it('wraps the band round the day when it runs past midnight, and draws one band when it does not', () => {
    const { bands } = setup({ on: true, start: 22 * 60, end: 7 * 60 });
    expect(bands()).toEqual([
      [22, 2],
      [0, 7]
    ]);
    expect(screen.getByText('22:00 – 07:00')).toBeInTheDocument();

    // Bring the start back to 13:00, then the end past it to 16:00: the step onto the start jumps over it.
    press(from(), 'ArrowDown', 18);
    expect(from()).toHaveAttribute('aria-valuetext', '13:00');
    press(to(), 'ArrowUp', 17);
    expect(to()).toHaveAttribute('aria-valuetext', '16:00');
    expect(bands()).toEqual([[13, 3]]);
  });
});
