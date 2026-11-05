// Wi-Fi setup from a phone, started by the button on the tablet's Wi-Fi setup page. The kiosk then advertises Improv Wi-Fi
// over Bluetooth (improv-gatt.ts) for a few minutes. Pressing the button is the proof that a person is next to the kiosk,
// so nothing else is advertised, ever: Improv's "authorized" state starts out true because of it. When the phone has
// joined a network the setup page is closed, as it is after a join on the tablet.
import { advertise } from './improv-gatt.ts';
import type { Advertising } from './improv-gatt.ts';
import { ImprovSession, State } from './improv.ts';
import type { Connect } from './improv.ts';

/** How long the phone has to find the kiosk and send the network. */
const ADVERTISE_MS = 5 * 60 * 1000;
/** After the phone is told it worked, so it sees the result before the page closes and the app comes back. */
const FINISH_MS = 4000;

export interface PhoneSetupOptions {
  connect: Connect;
  /** Closes the setup page. */
  done: () => void;
  advertise?: (session: ImprovSession) => Promise<Advertising>;
  advertiseMs?: number;
  finishMs?: number;
}

export class PhoneSetup {
  private readonly options: PhoneSetupOptions;
  private running:
    { advertising: Advertising; timer: ReturnType<typeof setTimeout>; unsubscribe: () => void } | undefined;
  private starting: Promise<void> | undefined;

  constructor(options: PhoneSetupOptions) {
    this.options = options;
  }

  private async begin(): Promise<void> {
    if (this.running) {
      clearTimeout(this.running.timer);
      this.running.timer = this.timeout();
      return;
    }
    const session = new ImprovSession(this.options.connect);
    const advertising = await (this.options.advertise ?? (target => advertise(target)))(session);
    const unsubscribe = session.onChange(() => {
      if (session.state === State.provisioned) {
        setTimeout(() => {
          void this.stop().then(() => {
            this.options.done();
          });
        }, this.options.finishMs ?? FINISH_MS);
      }
    });
    this.running = { advertising, timer: this.timeout(), unsubscribe };
  }

  private timeout(): ReturnType<typeof setTimeout> {
    return setTimeout(() => void this.stop(), this.options.advertiseMs ?? ADVERTISE_MS);
  }

  /** Starts advertising, or gives the phone another few minutes when it already is. Rejects when Bluetooth would not. */
  async start(): Promise<void> {
    const pending = (this.starting ??= this.begin());
    try {
      await pending;
    } finally {
      if (this.starting === pending) this.starting = undefined;
    }
  }

  /** Stops advertising. */
  async stop(): Promise<void> {
    const running = this.running;
    this.running = undefined;
    if (!running) return;
    clearTimeout(running.timer);
    running.unsubscribe();
    await running.advertising.stop();
  }
}
