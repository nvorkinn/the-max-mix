import { useState } from 'react';

/** A person's Spotify picture in a circle, or the first letter of their name when they have none. */
export default function PersonFace({
  name,
  imageUrl,
  className
}: Readonly<{ name: string; imageUrl: string; className: string }>) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (imageUrl && imageUrl !== failedSource) {
    return (
      <img src={imageUrl} alt="" className={`person-face ${className}`} onError={() => setFailedSource(imageUrl)} />
    );
  }
  return (
    <span className={`person-face person-face-letter ${className}`} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
