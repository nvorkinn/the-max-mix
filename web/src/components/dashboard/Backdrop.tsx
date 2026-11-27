import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/** How long a new day's photo takes to fade in over the old one: slow enough to read as the light changing. */
export const BACKDROP_FADE_MS = 4000;

/** A photo that won't load leaves the one showing as it is. */
const keepOld = () => {
  // Nothing to do.
};

interface Layer {
  url: string;
  /** Counts up with each photo, so a photo that comes back is a new layer rather than the old one reused. */
  id: number;
}

/**
 * The Dashboard's photo, full screen behind everything. When `url` changes, the new photo is loaded first and then
 * fades in over the old one, which goes once it is covered; a photo that fails to load leaves the old one showing.
 */
export default function Backdrop({ url }: Readonly<{ url: string }>) {
  const [layers, setLayers] = useState<readonly Layer[]>(() => [{ url, id: 0 }]);
  const top = layers.at(-1);

  useEffect(() => {
    if (top?.url === url) return;
    let done = false;
    const image = new Image();
    const show = () => {
      if (done) return;
      done = true;
      setLayers(current => [...current.slice(-1), { url, id: (current.at(-1)?.id ?? 0) + 1 }]);
    };
    image.src = url;
    // Decoding before the fade starts keeps the fade's first frames from waiting on the decoder.
    if (typeof image.decode === 'function') image.decode().then(show).catch(keepOld);
    else image.onload = show;
    return () => {
      done = true;
      image.onload = null;
    };
  }, [url, top?.url]);

  // Once the new photo has faded in, the one under it is covered and can go.
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers(current => current.slice(-1)), BACKDROP_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [layers]);

  return (
    <div className="dashboard-backdrop" aria-hidden="true">
      {layers.map((layer, index) => (
        <div
          key={layer.id}
          className="dashboard-backdrop-photo"
          data-arriving={(layers.length > 1 && index === layers.length - 1) || undefined}
          style={{ '--photo': `url(${JSON.stringify(layer.url)})` } as CSSProperties}
        />
      ))}
    </div>
  );
}
