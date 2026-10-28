const image = (id) => `https://images.unsplash.com/${id}?w=600&auto=format&fit=crop&q=80`;
const track = (id, name, artist, art, duration, guest) => ({
  id, name, artists: [{ name: artist }], duration_ms: duration,
  album: { images: [{ url: image(art) }] }, added_by: { name: guest }
});

export function createDemo() {
  return {
    playback: {
      is_playing: true, progress_ms: 45000,
      device: { id: 'demo-tablet', name: 'Demo tablet', is_active: true, volume_percent: 80, supports_volume: true },
      item: track('demo-track-1', 'One More Time', 'Daft Punk', 'photo-1514525253161-7a46d19cd819', 320000, 'Sarah')
    },
    queue: [
      track('demo-queue-1', 'Starboy', 'The Weeknd, Daft Punk', 'photo-1511671782779-c97d3d27a1d4', 230000, 'Marcus'),
      track('demo-queue-2', 'Levitating', 'Dua Lipa', 'photo-1470225620780-dba8ba36b745', 203000, 'Elena'),
      track('demo-queue-3', 'Music Sounds Better with You', 'Stardust', 'photo-1508700115892-45ecd05ae2ad', 260000, 'Dave'),
      track('demo-queue-4', 'Midnight City', 'M83', 'photo-1518609878373-06d740f60d8b', 244000, 'Chloe')
    ],
    history: []
  };
}
