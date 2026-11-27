// kiosk-health.service, run as root once each boot: settles a tried update (image-update.ts afterBoot), then gives the
// kiosk five minutes to come up (health.ts). Healthy: `rauc status mark-good`, which on a new slot's first boot makes
// it the slot every boot starts. Not healthy on that first boot: mark it bad and reboot into the old slot.
import { healthIO } from './health-io.ts';
import { waitForHealth } from './health.ts';
import { updateIO } from './image-update-io.ts';
import { afterBoot, giveUp, keep } from './image-update.ts';
import { raucOverDbus } from './rauc.ts';

const rauc = await raucOverDbus();
const io = updateIO(rauc);
try {
  const boot = await afterBoot(io);
  const wrong = await waitForHealth(healthIO);
  if (wrong === null) await keep(io, boot);
  else await giveUp(io, boot, wrong);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rauc.close();
}
