import type { SVGProps } from 'react';

type SleepIconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

/** A sleeping "zzz", drawn to match the lucide icons beside it (lucide has no such icon). */
const SleepIcon = ({ size = 24, ...props }: SleepIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M3 15h4l-4 5h4" />
    <path d="M9 9h5l-5 6h5" />
    <path d="M15 3h6l-6 7h6" />
  </svg>
);

export default SleepIcon;
