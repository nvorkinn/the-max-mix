// An on-screen keyboard for Spotify's sign-in pages on the kiosk. Cage has no protocol for a system keyboard, and the
// sign-in form is Spotify's page, not the app, so the extension draws this one at the bottom of the page whenever a
// text field has focus. Keys type with the editing command a real key press uses, which fires the same input events,
// so Spotify's form sees the text. Nothing is stored or sent anywhere.

type Page = 'letters' | 'symbols' | 'more';
export type Key =
  | { kind: 'char'; text: string }
  | { kind: 'shift' | 'backspace' | 'space' | 'done' }
  | { kind: 'page'; page: Page; label: string };

/** Height of the keyboard in CSS pixels; the page gets this much room at the bottom while it shows. */
export const KEYBOARD_HEIGHT = 262;

// Each row is written with spaces between the keys.
const chars = (row: string): Key[] => row.split(' ').map(text => ({ kind: 'char', text }));
const SHIFT: Key = { kind: 'shift' };
const BACKSPACE: Key = { kind: 'backspace' };
const toPage = (page: Page, label: string): Key => ({ kind: 'page', page, label });
const bottomRow = (page: Key): Key[] => [page, ...chars('@'), { kind: 'space' }, ...chars('.'), { kind: 'done' }];

const LAYOUTS: Record<Page, Key[][]> = {
  letters: [
    chars('q w e r t y u i o p'),
    chars('a s d f g h j k l'),
    [SHIFT, ...chars('z x c v b n m'), BACKSPACE],
    bottomRow(toPage('symbols', '?123'))
  ],
  symbols: [
    chars('1 2 3 4 5 6 7 8 9 0'),
    chars('- / : ; ( ) $ & " +'),
    [toPage('more', '#+='), ...chars(", ? ! ' _ ="), BACKSPACE],
    bottomRow(toPage('letters', 'ABC'))
  ],
  more: [
    chars('[ ] { } # % ^ * < >'),
    chars('\\ | ~ ` € £ ¥ •'),
    [toPage('symbols', '123'), ...chars(", ? ! ' _ ="), BACKSPACE],
    bottomRow(toPage('letters', 'ABC'))
  ]
};

const TEXT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number']);

export type Field = HTMLInputElement | HTMLTextAreaElement;

/** Whether the keyboard should show for this element: a text field that can be typed in. */
export function isTextField(element: Element | null): element is Field {
  if (element === null) return false;
  const isText =
    element.tagName === 'TEXTAREA' ||
    (element.tagName === 'INPUT' && TEXT_TYPES.has((element as HTMLInputElement).type));
  const field = element as Field;
  return isText && !field.disabled && !field.readOnly;
}

export function keyLabel(key: Key, shifted: boolean): string {
  switch (key.kind) {
    case 'char': {
      return shifted ? key.text.toUpperCase() : key.text;
    }
    case 'page': {
      return key.label;
    }
    case 'shift': {
      return '⇧';
    }
    case 'backspace': {
      return '⌫';
    }
    case 'space': {
      return 'space';
    }
    case 'done': {
      return 'Done';
    }
  }
}

// The fallback for a browser without editing commands (jsdom in the tests; Chromium has them): sets the value and tells
// the page.
function setValue(field: Field, value: string, caret: number): void {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  // Email and number fields have no selection, and throw when one is set.
  try {
    field.setSelectionRange(caret, caret);
  } catch {
    // The caret stays at the end.
  }
}

/** Types `text` at the caret, the way a key press does. */
export function insertText(field: Field, text: string): void {
  // Deprecated, but it is the one way to type that the page sees as typing (undo, input events, React's onChange).
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see above
  if (field.ownerDocument.execCommand('insertText', false, text)) return;
  const { value } = field;
  const start = field.selectionStart ?? value.length;
  const end = field.selectionEnd ?? value.length;
  setValue(field, value.slice(0, start) + text + value.slice(end), start + text.length);
}

/** Deletes the selection, or the character before the caret. */
export function deleteBackward(field: Field): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- as in insertText
  if (field.ownerDocument.execCommand('delete')) return;
  const { value } = field;
  const end = field.selectionEnd ?? value.length;
  const start = Math.min(field.selectionStart ?? value.length, end);
  const from = start === end ? Math.max(0, start - 1) : start;
  setValue(field, value.slice(0, from) + value.slice(end), from);
}

const STYLE = `
  :host { all: initial; }
  .board {
    position: fixed; inset: auto 0 0; z-index: 2147483647; box-sizing: border-box; height: ${KEYBOARD_HEIGHT}px;
    display: grid; grid-template-rows: repeat(4, 1fr); gap: 8px; padding: 8px 6px 10px;
    background: #121212; border-top: 1px solid #333; font: 500 24px/1 system-ui, sans-serif;
    touch-action: manipulation; user-select: none; -webkit-user-select: none;
  }
  .row { display: flex; gap: 6px; justify-content: center; }
  button {
    flex: 1 1 0; max-width: 96px; border: 0; border-radius: 8px; background: #2f2f2f; color: #fff; font: inherit;
    padding: 0; cursor: default;
  }
  button:active { background: #555; }
  .action { flex-grow: 1.5; max-width: 144px; background: #1f1f1f; font-size: 19px; }
  .space { flex-grow: 5; max-width: none; font-size: 19px; }
  .on { background: #1ed760; color: #000; }
  .on:active { background: #1ed760; }
`;

/** Shows the keyboard whenever a text field of `doc` has focus. Returns a function that removes it again. */
export function start(doc: Document): () => void {
  const host = doc.createElement('div');
  host.style.display = 'none';
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const board = doc.createElement('div');
  board.className = 'board';
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', 'On-screen keyboard');
  root.append(style, board);

  let page: Page = 'letters';
  let shifted = false;
  let field: Field | undefined;
  let savedPadding: string | undefined;

  const render = (): void => {
    const rows = LAYOUTS[page].map((keys, row) => {
      const line = doc.createElement('div');
      line.className = 'row';
      for (const [column, key] of keys.entries()) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.dataset['key'] = `${row}:${column}`;
        button.textContent = keyLabel(key, shifted && page === 'letters');
        if (key.kind === 'space') button.className = 'space';
        else if (key.kind !== 'char') button.className = 'action';
        if (key.kind === 'shift' && shifted) button.classList.add('on');
        if (key.kind === 'shift') button.setAttribute('aria-label', 'Shift');
        if (key.kind === 'backspace') button.setAttribute('aria-label', 'Delete');
        line.append(button);
      }
      return line;
    });
    board.replaceChildren(...rows);
  };

  const show = (target: Field): void => {
    field = target;
    if (!host.isConnected) doc.documentElement.append(host);
    if (host.style.display === 'none') {
      host.style.display = '';
      savedPadding = doc.body.style.paddingBottom;
      doc.body.style.paddingBottom = `${KEYBOARD_HEIGHT}px`;
    }
    target.scrollIntoView({ block: 'center' });
  };

  const hide = (): void => {
    field = undefined;
    if (host.style.display === 'none') return;
    host.style.display = 'none';
    doc.body.style.paddingBottom = savedPadding ?? '';
    page = 'letters';
    shifted = false;
    render();
  };

  const press = (key: Key, target: Field): void => {
    switch (key.kind) {
      case 'char': {
        insertText(target, shifted && page === 'letters' ? key.text.toUpperCase() : key.text);
        if (shifted) {
          shifted = false;
          render();
        }
        break;
      }
      case 'space': {
        insertText(target, ' ');
        break;
      }
      case 'backspace': {
        deleteBackward(target);
        break;
      }
      case 'shift': {
        shifted = !shifted;
        render();
        break;
      }
      case 'page': {
        page = key.page;
        shifted = false;
        render();
        break;
      }
      case 'done': {
        target.blur();
        hide();
        break;
      }
    }
  };

  // Pointer down, not click: a key acts as soon as it is touched, and cancelling it keeps the focus in the field.
  const onPointerDown = (event: Event): void => {
    event.preventDefault();
    const button = (event.target as Element | null)?.closest('button');
    const [row, column] = (button?.dataset['key'] ?? '').split(':').map(Number);
    const key = LAYOUTS[page][row ?? -1]?.[column ?? -1];
    if (key && field) press(key, field);
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (isTextField(event.target as Element | null)) show(event.target as Field);
  };

  // Focus moves through nothing on its way to another field, so look again once it has settled.
  const onFocusOut = (): void => {
    setTimeout(() => {
      if (!isTextField(doc.activeElement)) hide();
    }, 0);
  };

  render();
  board.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', onFocusOut, true);
  if (isTextField(doc.activeElement)) show(doc.activeElement);

  return () => {
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('focusout', onFocusOut, true);
    hide();
    host.remove();
  };
}
