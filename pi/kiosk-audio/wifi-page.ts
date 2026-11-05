// The Wi-Fi setup page in the browser. kiosk-audio serves it at
// http://127.0.0.1:7341/wifi-setup with its types stripped (wifi-setup.ts), because it has to work with no internet. It
// lists the networks in range, asks for the password on the sign-in keyboard (pi/kiosk-keyboard), and joins through
// GET /wifi/networks and POST /wifi/connect. On success, or on Cancel, it calls POST /wifi/done, which closes it. Like
// the app, it sends POST /heartbeat every 20 seconds, so the watchdog only restarts it when it hangs.
// ?can-cancel=1 shows Cancel (only when there is a connection to go back to).

interface Network {
  ssid: string;
  bars: number;
  security: 'open' | 'psk' | 'unsupported';
}

/** What the join form is for: a network from the list, or one joined by name. */
interface Join {
  ssid: string;
  isHidden: boolean;
}

export interface Page {
  list: HTMLElement;
  status: HTMLElement;
  error: HTMLElement;
  listView: HTMLElement;
  joinView: HTMLElement;
  joinTitle: HTMLElement;
  nameRow: HTMLElement;
  name: HTMLInputElement;
  password: HTMLInputElement;
  show: HTMLButtonElement;
  connect: HTMLButtonElement;
  refresh: HTMLButtonElement;
  cancel: HTMLButtonElement;
  busy: HTMLElement;
}

function element(doc: Document, id: string): HTMLElement {
  const found = doc.querySelector<HTMLElement>(`#${id}`);
  if (!found) throw new Error(`The page has no #${id}`);
  return found;
}

export function findPage(doc: Document): Page {
  return {
    list: element(doc, 'networks'),
    status: element(doc, 'status'),
    error: element(doc, 'error'),
    listView: element(doc, 'list-view'),
    joinView: element(doc, 'join-view'),
    joinTitle: element(doc, 'join-title'),
    nameRow: element(doc, 'name-row'),
    name: element(doc, 'name') as HTMLInputElement,
    password: element(doc, 'password') as HTMLInputElement,
    show: element(doc, 'show') as HTMLButtonElement,
    connect: element(doc, 'connect') as HTMLButtonElement,
    refresh: element(doc, 'refresh') as HTMLButtonElement,
    cancel: element(doc, 'cancel') as HTMLButtonElement,
    busy: element(doc, 'busy')
  };
}

const post = (path: string, body?: unknown): Promise<Response> =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) })
  });

const HEARTBEAT_MS = 20_000;

/** The page is finished (joined, or Cancel): the service closes it. */
async function close(): Promise<void> {
  await post('/wifi/done');
}

/** Wires the page to the service. `doc` and `fetch` come from the browser; the tests pass jsdom's. */
export function startPage(doc: Document, canCancel: boolean): { refresh: () => Promise<void> } {
  const page = findPage(doc);
  let join: Join | undefined;
  let isBusy = false;

  const showError = (message: string): void => {
    page.error.textContent = message;
    page.error.hidden = message === '';
  };

  const setBusy = (text: string): void => {
    isBusy = text !== '';
    page.busy.textContent = text;
    page.busy.hidden = !isBusy;
  };

  // One error line, moved into whichever view shows.
  const showList = (): void => {
    join = undefined;
    page.listView.insertBefore(page.error, page.status);
    page.joinView.hidden = true;
    page.listView.hidden = false;
    showError('');
  };

  const openJoin = (next: Join): void => {
    join = next;
    page.joinTitle.textContent = next.isHidden ? 'Other network' : `Join ${next.ssid}`;
    page.nameRow.hidden = !next.isHidden;
    page.name.value = '';
    page.password.value = '';
    page.password.type = 'password';
    page.show.textContent = 'Show';
    page.listView.hidden = true;
    page.joinView.hidden = false;
    page.joinView.append(page.error);
    showError('');
    (next.isHidden ? page.name : page.password).focus();
  };

  const connect = async (ssid: string, password: string, isHidden: boolean, security: string): Promise<void> => {
    if (isBusy) return;
    (doc.activeElement as HTMLElement | null)?.blur();
    showError('');
    setBusy(`Connecting to ${ssid}…`);
    try {
      const response = await post('/wifi/connect', { ssid, password, hidden: isHidden, security });
      const result = (await response.json()) as { ok: true } | { ok: false; error: string };
      if (result.ok) {
        setBusy(`Connected to ${ssid}`);
        await close();
        return;
      }
      showError(result.error);
    } catch {
      showError('Could not reach the kiosk service.');
    }
    setBusy('');
  };

  const row = (network: Network): HTMLElement => {
    const item = doc.createElement('li');
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'network';
    button.disabled = network.security === 'unsupported';
    const name = doc.createElement('span');
    name.className = 'ssid';
    name.textContent = network.ssid;
    const note = doc.createElement('span');
    note.className = 'note';
    if (network.security === 'unsupported') note.textContent = 'Not supported';
    else if (network.security === 'psk') note.textContent = '🔒';
    const bars = doc.createElement('span');
    bars.className = 'bars';
    bars.setAttribute('aria-label', `Signal ${network.bars} of 4`);
    for (let bar = 1; bar <= 4; bar += 1) {
      const level = doc.createElement('i');
      if (bar <= network.bars) level.className = 'on';
      bars.append(level);
    }
    button.append(name, note, bars);
    button.addEventListener('click', () => {
      if (network.security === 'open') void connect(network.ssid, '', false, 'open');
      else openJoin({ ssid: network.ssid, isHidden: false });
    });
    item.append(button);
    return item;
  };

  const refresh = async (): Promise<void> => {
    page.refresh.disabled = true;
    page.status.textContent = 'Looking for networks…';
    showError('');
    try {
      const response = await fetch('/wifi/networks');
      const body = (await response.json()) as { networks?: Network[]; error?: string };
      const networks = body.networks ?? [];
      page.list.replaceChildren(...networks.map(network => row(network)));
      page.status.textContent = networks.length === 0 ? 'No networks found. Tap Refresh to scan again.' : '';
      if (body.error) showError(body.error);
    } catch {
      page.status.textContent = '';
      showError('Could not reach the kiosk service.');
    }
    page.refresh.disabled = false;
  };

  const submit = (): void => {
    if (!join) return;
    const ssid = join.isHidden ? page.name.value.trim() : join.ssid;
    if (ssid === '' || (!join.isHidden && page.password.value === '')) return;
    void connect(ssid, page.password.value, join.isHidden, 'psk');
  };

  page.refresh.addEventListener('click', () => void refresh());
  element(doc, 'other').addEventListener('click', () => {
    openJoin({ ssid: '', isHidden: true });
  });
  element(doc, 'back').addEventListener('click', showList);
  page.connect.addEventListener('click', submit);
  element(doc, 'join-form').addEventListener('submit', event => {
    event.preventDefault();
    submit();
  });
  page.show.addEventListener('click', () => {
    const isHiddenNow = page.password.type === 'password';
    page.password.type = isHiddenNow ? 'text' : 'password';
    page.show.textContent = isHiddenNow ? 'Hide' : 'Show';
  });
  page.cancel.hidden = !canCancel;
  page.cancel.addEventListener('click', () => void close());

  showList();
  setBusy('');
  return { refresh };
}

/** Starts the page in the browser: the keyboard, then the first scan. Not run in the tests. */
export async function main(): Promise<void> {
  // A URL on this service (wifi-setup.ts serves the sign-in keyboard's built file there), not a path TypeScript knows.
  const keyboardUrl = '/wifi-setup/keyboard.js';
  const keyboard = (await import(keyboardUrl)) as typeof import('../kiosk-keyboard/keyboard.ts');
  keyboard.start(document);
  void post('/heartbeat');
  setInterval(() => void post('/heartbeat'), HEARTBEAT_MS);
  const canCancel = new URLSearchParams(location.search).get('can-cancel') === '1';
  await startPage(document, canCancel).refresh();
}
