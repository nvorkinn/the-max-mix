import { AlertCircle, ArrowUpCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { KioskUpdate } from '../../hooks/useKioskUpdate';

/** Where the Pi's software stands, so the overview and the Software page show it with the same icon and colour. */
export type SoftwareState = 'checking' | 'current' | 'newer' | 'unknown' | 'updating';

export function softwareState({ version, latest, newer, isUpdating }: KioskUpdate): SoftwareState {
  if (isUpdating) return 'updating';
  if (!version || latest.state === 'unknown') return 'unknown';
  if (latest.state === 'checking') return 'checking';
  return newer ? 'newer' : 'current';
}

export const SOFTWARE_LOOK: Record<SoftwareState, { icon: LucideIcon; tone: string; spin?: boolean }> = {
  checking: { icon: LoaderCircle, tone: 'text-muted', spin: true },
  updating: { icon: LoaderCircle, tone: 'status-warning', spin: true },
  current: { icon: CheckCircle2, tone: 'status-success' },
  newer: { icon: ArrowUpCircle, tone: 'status-warning' },
  unknown: { icon: AlertCircle, tone: 'text-muted' }
};
