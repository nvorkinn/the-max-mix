import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteBackward, insertText, isTextField, KEYBOARD_HEIGHT, keyLabel, start } from './keyboard.ts';

// jsdom has no editing commands. Chromium does, and then the fallback that sets the value is not used.
function mockEditing(result: boolean) {
  const execCommand = vi.fn(() => result);
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });
  return execCommand;
}

function input(type = 'text'): HTMLInputElement {
  const field = document.createElement('input');
  field.type = type;
  document.body.append(field);
  return field;
}

describe('isTextField', () => {
  it('accepts text fields and text areas', () => {
    expect(isTextField(input('email'))).toBe(true);
    expect(isTextField(input('password'))).toBe(true);
    expect(isTextField(document.createElement('textarea'))).toBe(true);
  });

  it('rejects other elements and fields that cannot be typed in', () => {
    expect(isTextField(null)).toBe(false);
    expect(isTextField(document.createElement('button'))).toBe(false);
    expect(isTextField(input('checkbox'))).toBe(false);
    const disabled = input();
    disabled.disabled = true;
    expect(isTextField(disabled)).toBe(false);
    const readOnly = input();
    readOnly.readOnly = true;
    expect(isTextField(readOnly)).toBe(false);
  });
});

describe('keyLabel', () => {
  it('shows capitals while shifted', () => {
    expect(keyLabel({ kind: 'char', text: 'q' }, false)).toBe('q');
    expect(keyLabel({ kind: 'char', text: 'q' }, true)).toBe('Q');
    expect(keyLabel({ kind: 'page', page: 'symbols', label: '?123' }, true)).toBe('?123');
  });
});

describe('typing', () => {
  beforeEach(() => {
    mockEditing(false);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('inserts at the caret and tells the page', () => {
    const field = input();
    field.value = 'ac';
    field.setSelectionRange(1, 1);
    const onInput = vi.fn();
    field.addEventListener('input', onInput);
    insertText(field, 'b');
    expect(field.value).toBe('abc');
    expect(field.selectionStart).toBe(2);
    expect(onInput).toHaveBeenCalledOnce();
  });

  it('uses the editing command when the browser has it', () => {
    const execCommand = mockEditing(true);
    const field = input();
    insertText(field, 'x');
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'x');
    expect(field.value).toBe('');
  });

  it('deletes the character before the caret, or the selection', () => {
    const field = input();
    field.value = 'abcd';
    field.setSelectionRange(2, 2);
    deleteBackward(field);
    expect(field.value).toBe('acd');
    field.setSelectionRange(1, 3);
    deleteBackward(field);
    expect(field.value).toBe('a');
    field.setSelectionRange(0, 0);
    deleteBackward(field);
    expect(field.value).toBe('a');
  });
});

describe('start', () => {
  let stop: () => void;
  const scrollIntoView = vi.fn();

  const board = (): HTMLElement => {
    const host = document.documentElement.lastElementChild as HTMLElement;
    return host.shadowRoot?.querySelector('.board') as HTMLElement;
  };
  const isShown = (): boolean => (document.documentElement.lastElementChild as HTMLElement).style.display !== 'none';
  const tap = (label: string): void => {
    const key = [...board().querySelectorAll('button')].find(
      button => button.textContent === label || button.getAttribute('aria-label') === label
    );
    if (!key) throw new Error(`no key ${label}`);
    key.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockEditing(false);
    Element.prototype.scrollIntoView = scrollIntoView;
    stop = start(document);
  });

  afterEach(() => {
    stop();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('shows while a text field has focus and makes room for itself', () => {
    const field = input('email');
    field.focus();
    expect(isShown()).toBe(true);
    expect(document.body.style.paddingBottom).toBe(`${KEYBOARD_HEIGHT}px`);
    expect(scrollIntoView).toHaveBeenCalled();

    field.blur();
    vi.runAllTimers();
    expect(isShown()).toBe(false);
    expect(document.body.style.paddingBottom).toBe('');
  });

  it('types letters, a capital after Shift, symbols and spaces', () => {
    const field = input();
    field.focus();
    tap('Shift');
    tap('h');
    tap('i');
    tap('space');
    tap('?123');
    tap('1');
    tap('#+=');
    tap('%');
    tap('ABC');
    tap('@');
    tap('Delete');
    expect(field.value).toBe('Hi 1%');
    expect(document.activeElement).toBe(field);
  });

  it('stays up when focus moves to another field', () => {
    const first = input();
    const second = input('password');
    first.focus();
    second.focus();
    vi.runAllTimers();
    expect(isShown()).toBe(true);
    tap('k');
    expect(second.value).toBe('k');
  });

  it('hides on Done', () => {
    const field = input();
    field.focus();
    tap('Done');
    expect(isShown()).toBe(false);
    expect(document.activeElement).not.toBe(field);
  });
});
