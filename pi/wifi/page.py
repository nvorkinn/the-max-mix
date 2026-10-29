"""The portal page: one self-contained HTML document (no external assets, works offline) and the QR code as inline SVG."""

from html import escape

import logic
import qrcodegen

STYLE = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; padding: 16px; background: #0b0b10; color: #ececf3; font: 18px/1.4 system-ui, sans-serif; }
body.kb { padding-bottom: 300px; }
main { max-width: 640px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 12px; }
h2 { font-size: 18px; margin: 0 0 8px; }
.card { background: #17171f; border: 1px solid #2a2a36; border-radius: 14px; padding: 16px; margin: 0 0 16px; }
.notice { border-radius: 14px; padding: 14px 16px; margin: 0 0 16px; font-weight: 600; }
.notice.ok { background: #12351f; border: 1px solid #1f8a46; }
.notice.error { background: #3a1519; border: 1px solid #b3303c; }
.notice.info { background: #17171f; border: 1px solid #2a2a36; }
label { display: block; font-weight: 600; margin: 12px 0 6px; }
input[type=text], input[type=password] { width: 100%; min-height: 52px; padding: 10px 14px; border-radius: 12px;
  border: 1px solid #3a3a4a; background: #0b0b10; color: inherit; font: inherit; }
.check { display: flex; align-items: center; gap: 12px; min-height: 48px; font-weight: 400; }
.check input { width: 28px; height: 28px; }
button, .button { display: inline-flex; align-items: center; justify-content: center; min-height: 52px; padding: 10px 22px;
  border-radius: 12px; border: 1px solid #3a3a4a; background: #23232e; color: inherit; font: inherit; font-weight: 600;
  text-decoration: none; cursor: pointer; }
button.primary, .button.primary { background: #1ed760; border-color: #1ed760; color: #04120a; }
button.danger { border-color: #b3303c; color: #ff9aa3; }
.row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
ul.nets { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.net { width: 100%; justify-content: space-between; text-align: left; font-weight: 400; }
.net b { font-weight: 600; }
.muted { color: #a0a0b4; font-size: 16px; }
.secret { font: 600 28px/1.2 ui-monospace, monospace; letter-spacing: 2px; background: #0b0b10; border-radius: 10px;
  padding: 8px 14px; display: inline-block; }
.qr { background: #fff; padding: 8px; border-radius: 10px; display: inline-block; line-height: 0; }
.qr svg { width: 220px; height: 220px; }
.hotspot { display: flex; flex-wrap: wrap; gap: 20px; align-items: center; }
#osk { position: fixed; left: 0; right: 0; bottom: 0; padding: 8px; background: #101018; border-top: 1px solid #2a2a36; }
#osk .row { display: flex; justify-content: center; gap: 6px; margin: 0 0 6px; flex-wrap: nowrap; }
.k { flex: 1 1 0; max-width: 84px; min-height: 52px; padding: 0; font-size: 22px; }
.k.wide { flex: 2 1 0; max-width: 150px; }
.k.space { flex: 6 1 0; max-width: 480px; }
"""

OSK_SCRIPT = r"""
(function () {
  var osk = document.getElementById('osk');
  if (!osk) return;
  var layers = [
    ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
    ['1234567890', '!@#$%^&*()', '-_=+[]{};:', '\'"\\|,./?~`']
  ];
  var layer = 0, shift = false, target = null;
  function press(ev) { ev.preventDefault(); }
  function key(label, cls, action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'k ' + cls;
    button.addEventListener('pointerdown', press);
    button.addEventListener('mousedown', press);
    button.addEventListener('click', action);
    return button;
  }
  function insert(text) {
    if (!target) return;
    target.setRangeText(text, target.selectionStart, target.selectionEnd, 'end');
  }
  function erase() {
    if (!target) return;
    var start = target.selectionStart, end = target.selectionEnd;
    if (start === end && start > 0) start -= 1;
    target.setRangeText('', start, end, 'end');
  }
  function render() {
    osk.textContent = '';
    layers[layer].forEach(function (chars, index) {
      var row = document.createElement('div');
      row.className = 'row';
      if (index === 3 && layer === 0) {
        row.appendChild(key(shift ? '\u21e9' : '\u21e7', 'wide', function () { shift = !shift; render(); }));
      }
      chars.split('').forEach(function (char) {
        var shown = shift && layer === 0 ? char.toUpperCase() : char;
        row.appendChild(key(shown, '', function () {
          insert(shown);
          if (shift) { shift = false; render(); }
        }));
      });
      if (index === 3) row.appendChild(key('\u232b', 'wide', erase));
      osk.appendChild(row);
    });
    var last = document.createElement('div');
    last.className = 'row';
    last.appendChild(key(layer ? 'abc' : '123', 'wide', function () { layer = layer ? 0 : 1; render(); }));
    last.appendChild(key('space', 'space', function () { insert(' '); }));
    last.appendChild(key('Hide', 'wide', function () { osk.hidden = true; document.body.classList.remove('kb'); }));
    osk.appendChild(last);
  }
  document.addEventListener('focusin', function (event) {
    var field = event.target;
    if (field && field.matches && field.matches('input[type=text], input[type=password]')) {
      target = field;
      osk.hidden = false;
      document.body.classList.add('kb');
      field.scrollIntoView({ block: 'center' });
    }
  });
  render();
}());
"""

PAGE_SCRIPT = r"""
(function () {
  var ssid = document.getElementById('ssid');
  var password = document.getElementById('password');
  var show = document.getElementById('show');
  if (show && password) {
    show.addEventListener('change', function () { password.type = show.checked ? 'text' : 'password'; });
  }
  document.querySelectorAll('.net').forEach(function (button) {
    button.addEventListener('click', function () {
      if (!ssid) return;
      ssid.value = button.dataset.ssid;
      if (password) password.focus();
    });
  });
}());
"""


def qr_svg(text):
    """The text as an inline SVG QR code (medium error correction, 2-module quiet zone)."""
    code = qrcodegen.QrCode.encode_text(text, qrcodegen.QrCode.Ecc.MEDIUM)
    border = 2
    size = code.get_size()
    cells = []
    for y in range(size):
        for x in range(size):
            if code.get_module(x, y):
                cells.append(f'M{x + border},{y + border}h1v1h-1z')
    total = size + border * 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} {total}" shape-rendering="crispEdges" '
        'role="img" aria-label="QR code that joins the setup Wi-Fi network">'
        f'<rect width="{total}" height="{total}" fill="#fff"/><path d="{"".join(cells)}" fill="#000"/></svg>'
    )


def _notice(notice):
    if not notice:
        return ''
    return f'<p class="notice {escape(notice["kind"])}" role="status">{escape(notice["text"])}</p>'


def _hotspot_card(hotspot, keyboard):
    if not hotspot:
        return (
            '<section class="card"><h2>Setup network</h2><p>The setup Wi-Fi network could not be started. '
            'It will be retried; plug in an Ethernet cable if this continues.</p></section>'
        )
    payload = logic.wifi_qr_payload(hotspot['ssid'], hotspot['password'])
    return (
        '<section class="card"><h2>Set up on your phone</h2><div class="hotspot">'
        f'<div class="qr">{qr_svg(payload)}</div>'
        '<div><p>Scan the code with your phone camera, or join this Wi-Fi network by hand:</p>'
        f'<p class="muted">Network</p><p><span class="secret">{escape(hotspot["ssid"])}</span></p>'
        f'<p class="muted">Password</p><p><span class="secret">{escape(hotspot["password"])}</span></p>'
        '<p class="muted">Then open any web page, or go to '
        f'<b>http://{escape(hotspot["gateway"])}/</b>.</p></div></div></section>'
        + (
            ''
            if not keyboard
            else '<p class="muted">Or use this screen: choose your network below and type its password.</p>'
        )
    )


def _networks(networks, current_ssid):
    if not networks:
        return '<p class="muted">No networks found yet. Type the name below, or search again.</p>'
    items = []
    for network in networks:
        bars = '\u2022' * (1 + network['signal'] // 34)
        flags = ('Connected, ' if network['ssid'] == current_ssid else '') + ('secured' if network['secure'] else 'open')
        items.append(
            f'<li><button type="button" class="net" data-ssid="{escape(network["ssid"])}">'
            f'<b>{escape(network["ssid"])}</b><span class="muted">{escape(flags)} {bars}</span></button></li>'
        )
    return f'<ul class="nets">{"".join(items)}</ul>'


def _form(view, csrf, keyboard, switching):
    mode = 'none' if keyboard else 'text'
    return (
        f'<section class="card"><h2>{"Switch to another network" if switching else "Choose a network"}</h2>'
        + _networks(view['networks'], (view.get('current') or {}).get('ssid'))
        + '<form method="post" action="/rescan"><input type="hidden" name="csrf" value="'
        + escape(csrf)
        + '"><div class="row"><button type="submit">Search again</button></div></form>'
        + '<form method="post" action="/connect" autocomplete="off">'
        + f'<input type="hidden" name="csrf" value="{escape(csrf)}">'
        + '<label for="ssid">Network name</label>'
        + f'<input id="ssid" name="ssid" type="text" maxlength="32" required inputmode="{mode}" autocapitalize="none" '
        + f'autocorrect="off" spellcheck="false" value="{escape(view.get("ssid_prefill", ""))}">'
        + '<label for="password">Password (leave empty for an open network)</label>'
        + f'<input id="password" name="password" type="password" maxlength="64" inputmode="{mode}" '
        + 'autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off">'
        + '<label class="check"><input id="show" type="checkbox"> Show password</label>'
        + '<label class="check"><input name="hidden" type="checkbox" value="yes"> Hidden network</label>'
        + '<div class="row"><button class="primary" type="submit">Connect</button></div></form></section>'
    )


def _current(view, csrf):
    current = view.get('current')
    if not current:
        return ''
    forget = ''
    if current.get('forgettable'):
        forget = (
            '<form method="post" action="/forget"><input type="hidden" name="csrf" value="'
            + escape(csrf)
            + '"><button class="danger" type="submit">Forget this network</button></form>'
        )
    return (
        '<section class="card"><h2>Current network</h2>'
        f'<p><b>{escape(current["name"])}</b></p>'
        f'<div class="row"><a class="button primary" href="{escape(view["kiosk_url"])}">Back to THE MAX MIX</a>{forget}</div>'
        '</section>'
    )


def render_index(view, csrf, nonce, keyboard):
    """The whole page for the current state. `view` is the controller's snapshot."""
    phase = view['phase']
    refresh = ''
    body = _notice(view.get('notice'))
    if phase == 'booting':
        refresh = '<meta http-equiv="refresh" content="3">'
        body += '<p class="notice info" role="status">Checking the network\u2026</p>'
    elif phase == 'connecting':
        refresh = '<meta http-equiv="refresh" content="3">'
        body += (
            '<section class="card"><h2>Connecting\u2026</h2><p>This can take up to a minute. '
            'If you set this up from your phone, it now leaves the setup network. Watch the Pi\u2019s screen: it shows '
            '\u201cConnected\u201d, or the setup network comes back with a new password.</p></section>'
        )
    elif phase == 'setup':
        body += _hotspot_card(view.get('hotspot'), keyboard) + _form(view, csrf, keyboard, False)
    else:
        body += _current(view, csrf) + _form(view, csrf, keyboard, True)
    osk = '<div id="osk" hidden aria-label="On-screen keyboard"></div>' if keyboard and phase in ('setup', 'manage') else ''
    scripts = f'<script nonce="{nonce}">{PAGE_SCRIPT}{OSK_SCRIPT if osk else ""}</script>'
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'{refresh}<title>THE MAX MIX Wi-Fi</title><style nonce="{nonce}">{STYLE}</style></head>'
        f'<body><main><h1>THE MAX MIX \u00b7 Wi-Fi</h1>{body}</main>{osk}{scripts}</body></html>'
    )


def render_text(message):
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>THE MAX MIX Wi-Fi</title></head>'
        f'<body><p>{escape(message)}</p></body></html>'
    )
