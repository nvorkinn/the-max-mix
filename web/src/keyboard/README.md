# THE MAX MIX on-screen keyboard

The kiosk's touch screen has no keyboard, and Cage (the compositor) has none of the Wayland protocols a system keyboard
needs, so the app draws its own. The app loads `keyboard.ts` on the kiosk only and starts it inside the dialog that wants
it (music search, stop and place search, the postcode, the Wi-Fi password), since a modal dialog makes the rest of the
page untouchable. While the keyboard shows it sets `--keyboard-height` on the page, and the app's dialogs move up above
it.

Spotify's sign-in pages get no keyboard: people sign in with **Continue with Apple**, whose page shows a QR code to scan
with an iPhone, so nothing is typed on the tablet.

## The keyboard

- When a text field gets focus, the keyboard appears at the bottom of the screen (262 pixels high), the page gets the
  same room at the bottom, and the field scrolls into view. It hides when no field has focus, or on **Done**.
- Three layouts: letters (with a one-shot Shift, `@` and `.`), digits and symbols, and more symbols.
- The app's Wi-Fi join dialog asks for a row of digits that stays at the top (`hasNumberRow`), for passwords: five rows, 290
  pixels high, with the letters and one page holding every other ASCII symbol.
- The app's Dashboard dialogs (stop and place search, the notice board's postcode) ask for the number row too. The
  postcode's also asks for capitals only (`isUppercase`): the letters show and type as capitals, with no Shift key.
- Keys type with the browser's own editing command (`insertText`), which fires the same trusted input events as a key
  press. Each key acts on touch and keeps the focus in the field.
- The keyboard stores nothing and sends nothing. It draws inside a shadow root, so the page's styles do not reach it.

## Tests

`npm test` runs `keyboard.test.ts`, in jsdom, which has no editing commands, so the fallback that sets the value is what
types there.
