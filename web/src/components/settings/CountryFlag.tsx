import { useId } from 'react';
import type { NoticeBoard } from 'countdown-api';
import { useT } from '../../i18n/translate';

type Country = NonNullable<NoticeBoard['country']>;

/** The Union Flag, drawn rather than an emoji, which the kiosk's Chromium on Linux has no font for. */
function UnionFlag() {
  const clipId = useId();
  const diagonalsId = useId();
  return (
    <svg viewBox="0 0 60 30" className="country-flag-art" aria-hidden="true">
      <clipPath id={clipId}>
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id={diagonalsId}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${diagonalsId})`} stroke="#c8102e" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
      </g>
    </svg>
  );
}

function NorwegianFlag() {
  return (
    <svg viewBox="0 0 22 16" className="country-flag-art" aria-hidden="true">
      <rect width="22" height="16" fill="#ba0c2f" />
      <path d="M6,0 h4 v16 h-4 z M0,6 h22 v4 h-22 z" fill="#fff" />
      <path d="M7,0 h2 v16 h-2 z M0,7 h22 v2 h-22 z" fill="#00205b" />
    </svg>
  );
}

/** A country's flag, named for screen readers. */
export default function CountryFlag({ country, className = '' }: Readonly<{ country: Country; className?: string }>) {
  const t = useT();
  return (
    <span role="img" aria-label={t(`country.${country}`)} className={`country-flag ${className}`}>
      {country === 'GB' ? <UnionFlag /> : <NorwegianFlag />}
    </span>
  );
}
