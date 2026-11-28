// An audio element for the tests, which jsdom can't play: play and pause change `paused` and fire their events at
// once, a seek fires `seeked`, and `instances` lists every one made, newest last.

export class FakeAudio extends EventTarget {
  static readonly instances: FakeAudio[] = [];
  private time = 0;
  preload = '';
  paused = true;
  duration = NaN;
  error: { code: number } | null = null;
  src = '';

  constructor() {
    super();
    FakeAudio.instances.push(this);
  }

  get currentTime(): number {
    return this.time;
  }

  set currentTime(value: number) {
    this.time = value;
    this.dispatchEvent(new Event('seeked'));
  }

  /** Moves the position as playing would, without a seek. */
  advance(seconds: number): void {
    this.time += seconds;
    this.dispatchEvent(new Event('timeupdate'));
  }

  play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }

  /** Plays to the end, as the element does: paused, then ended. */
  end(): void {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
    this.dispatchEvent(new Event('ended'));
  }

  load(): void {
    // Nothing to load.
  }

  canPlayType(): string {
    return '';
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
}
