import { useState } from 'react';
import type { ReactNode } from 'react';
import { Disc3 } from 'lucide-react';
import { debugLog } from '../utils/debugLog';

interface ImageProps {
  src?: string | undefined;
  alt: string;
  className: string;
}

function ImageWithFallback({ src, alt, className, fallback }: Readonly<ImageProps & { fallback: ReactNode }>) {
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (!src || src === failedSource) {
    return (
      <span
        className={`${className} image-placeholder`}
        role={alt ? 'img' : undefined}
        aria-label={alt ? `${alt} unavailable` : undefined}
        aria-hidden={alt ? undefined : true}
      >
        {fallback}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        setFailedSource(src);
        debugLog('warn', 'image', `Could not load ${alt || 'an image'}; showing a placeholder.`);
      }}
    />
  );
}

export function Artwork(props: Readonly<ImageProps>) {
  return <ImageWithFallback {...props} fallback={<Disc3 aria-hidden="true" />} />;
}
