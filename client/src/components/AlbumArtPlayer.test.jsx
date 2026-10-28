import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AlbumArtPlayer from './AlbumArtPlayer.jsx';

vi.mock('./AudioVisualizer.jsx', () => ({ default: () => null }));

const withVolume = (volume_percent) => ({ device: { volume_percent, supports_volume: true } });
const player = (playback) => <AlbumArtPlayer playback={playback} controlsEnabled />;

describe('AlbumArtPlayer volume', () => {
  it('starts at the device volume and follows device changes', () => {
    const { rerender } = render(player(withVolume(40)));
    expect(screen.getByLabelText('Volume')).toHaveValue('40');
    rerender(player(withVolume(70)));
    expect(screen.getByLabelText('Volume')).toHaveValue('70');
  });

  it('keeps a local change until the device reports a different volume', () => {
    const { rerender } = render(player(withVolume(40)));
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '15' } });
    expect(screen.getByLabelText('Volume')).toHaveValue('15');
    rerender(player(withVolume(40)));
    expect(screen.getByLabelText('Volume')).toHaveValue('15');
    rerender(player(withVolume(55)));
    expect(screen.getByLabelText('Volume')).toHaveValue('55');
  });
});
