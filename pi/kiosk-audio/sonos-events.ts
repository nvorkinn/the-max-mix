// Live Sonos changes for the app, so it need not keep asking. While the app listens (GET /sonos/events in server.ts),
// the Pi subscribes to the speakers' own events (UPnP): the household's grouping on one speaker, and on each group's
// leading speaker what it plays and its volume. The speakers deliver those to a small HTTP listener that the sonos-ts
// library opens on the home network (SONOS_LISTENER_PORT, 6329). Each change reaches the app as one word, "groups" or
// "now", and the app reads what changed through the usual GETs. When the last app goes away, the subscriptions end.

/** What changed: the household's grouping, or what a group plays (song, play or pause, volume). */
export type SonosChange = 'groups' | 'now';

/** A speaker, as the library needs it to subscribe. */
export interface SonosSpeaker {
  uuid: string;
  name: string;
  host: string;
  port: number;
}

/** The speaker events to follow: the grouping, what a group plays, and its volume. */
export type SonosService = 'topology' | 'transport' | 'volume';

/** The household's speakers and their events; sonos-library.ts answers, tests pass fakes. */
export interface SonosEventSource {
  /** The speaker that leads each group. */
  coordinators: () => Promise<SonosSpeaker[]>;
  /** Calls `onEvent` for each of the speaker's events of that kind; returns how to stop (which ends the subscription). */
  listen: (speaker: SonosSpeaker, service: SonosService, onEvent: () => void) => () => void;
}

/** Changes of one kind within this long reach the app as one. */
const SETTLE_MS = 250;

/** Hands the speakers' events to the apps listening, subscribing only while one is. */
export class SonosEventHub {
  private readonly clients = new Set<(change: SonosChange) => void>();
  /** The subscriptions held, by "service uuid", and how to end each. */
  private readonly subscriptions = new Map<string, () => void>();
  private readonly timers = new Map<SonosChange, ReturnType<typeof setTimeout>>();
  /** Following runs one at a time, so a burst of grouping changes cannot subscribe twice. */
  private following: Promise<void> = Promise.resolve();

  private readonly source: SonosEventSource;
  private readonly log: (message: string) => void;

  constructor(
    source: SonosEventSource,
    log: (message: string) => void = message => {
      console.warn(message);
    }
  ) {
    this.source = source;
    this.log = log;
  }

  /** Runs `step` once the steps before it have run; a step that fails is logged, and the next ones still run. */
  private enqueue(step: () => Promise<void> | void): void {
    const previous = this.following;
    this.following = (async () => {
      await previous;
      try {
        await step();
      } catch (error) {
        this.log(`sonos: following the speakers failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }

  private follow(): void {
    this.enqueue(() => this.subscribe());
  }

  /** Subscribes to the grouping and to each group's leading speaker, and ends the subscriptions no longer needed. */
  private async subscribe(): Promise<void> {
    if (this.clients.size === 0) return;
    let speakers: SonosSpeaker[];
    try {
      speakers = await this.source.coordinators();
    } catch (error) {
      this.log(`sonos: no speaker to follow: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (this.clients.size === 0) return;
    const wanted = new Map<string, { speaker: SonosSpeaker; service: SonosService }>();
    const [first] = speakers;
    // Every speaker knows the whole household's grouping, so one is enough.
    if (first) wanted.set(`topology ${first.uuid}`, { speaker: first, service: 'topology' });
    for (const speaker of speakers) {
      wanted.set(`transport ${speaker.uuid}`, { speaker, service: 'transport' });
      wanted.set(`volume ${speaker.uuid}`, { speaker, service: 'volume' });
    }
    for (const [key, stop] of this.subscriptions) {
      if (wanted.has(key)) continue;
      stop();
      this.subscriptions.delete(key);
    }
    for (const [key, { speaker, service }] of wanted) {
      if (this.subscriptions.has(key)) continue;
      const change: SonosChange = service === 'topology' ? 'groups' : 'now';
      this.subscriptions.set(
        key,
        this.source.listen(speaker, service, () => {
          this.changed(change);
        })
      );
    }
  }

  private unsubscribeAll(): void {
    for (const stop of this.subscriptions.values()) stop();
    this.subscriptions.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private changed(change: SonosChange): void {
    // A new grouping can bring new leading speakers to follow.
    if (change === 'groups') this.follow();
    if (this.timers.has(change)) return;
    this.timers.set(
      change,
      setTimeout(() => {
        this.timers.delete(change);
        for (const client of this.clients) client(change);
      }, SETTLE_MS)
    );
  }

  /** Waits for the subscriptions to match the household (for tests). */
  settled(): Promise<void> {
    return this.following;
  }

  /** Sends each change to `client` until the returned function is called. */
  add(client: (change: SonosChange) => void): () => void {
    this.clients.add(client);
    if (this.clients.size === 1) this.follow();
    return () => {
      if (!this.clients.delete(client) || this.clients.size > 0) return;
      this.enqueue(() => {
        // Someone may have started listening again meanwhile.
        if (this.clients.size === 0) this.unsubscribeAll();
      });
    };
  }
}
