//! The kiosk's window. Cage runs kiosk-session, which runs this with the app's address (http://127.0.0.1:7341/...):
//! one full-screen WebKit view on it, until the window closes. The app talks only to kiosk-audio; nothing talks to this.

use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "linux")]
mod awake;

/// Sites the view may leave the app for, besides the app's own origin: Spotify's sign-in (with its challenge pages) and
/// countdown-server's pages (device registration, the settings site).
const ALLOWED_DOMAINS: &[&str] = &["spotify.com", "countdown.run", "countdown.build"];

fn allowed(app: &Url, to: &Url) -> bool {
    if to.origin() == app.origin() || to.scheme() == "about" || to.scheme() == "blob" || to.scheme() == "data" {
        return true;
    }
    to.scheme() == "https"
        && to.host_str().is_some_and(|host| {
            ALLOWED_DOMAINS
                .iter()
                .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        })
}

fn main() {
    let app_url: Url = match std::env::args().nth(1).map(|arg| arg.parse()) {
        Some(Ok(url)) => url,
        _ => {
            eprintln!("usage: kiosk-shell <app address>");
            std::process::exit(2);
        }
    };

    tauri::Builder::default()
        .setup(move |app| {
            let app_for_check = app_url.clone();
            let window = WebviewWindowBuilder::new(app, "app", WebviewUrl::External(app_url.clone()))
                .title("THE MAX MIX")
                .fullscreen(true)
                .decorations(false)
                .on_navigation(move |to| {
                    let ok = allowed(&app_for_check, to);
                    if !ok {
                        eprintln!("kiosk-shell: refused navigation to {to}");
                    }
                    ok
                })
                .build()?;
            #[cfg(target_os = "linux")]
            {
                window.with_webview(|webview| linux::configure(&webview.inner()))?;
                awake::start(window.gtk_window()?);
            }
            #[cfg(not(target_os = "linux"))]
            let _ = window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("kiosk-shell: the window failed");
}

#[cfg(target_os = "linux")]
mod linux {
    use webkit2gtk::{PermissionRequestExt, SettingsExt, WebView, WebViewExt};

    /// What a kiosk needs from WebKitGTK that Tauri does not set.
    pub fn configure(webview: &WebView) {
        if let Some(settings) = WebViewExt::settings(webview) {
            // The app starts music and plays sounds without a tap first (Chromium's --autoplay-policy flag).
            settings.set_media_playback_requires_user_gesture(false);
            settings.set_enable_back_forward_navigation_gestures(false);
        }
        // No context menu on a long press or a right click.
        webview.connect_context_menu(|_, _, _, _| true);
        // Only the app and the sites above load, so grant what they ask for (location, notifications, the wake lock).
        webview.connect_permission_request(|_, request| {
            request.allow();
            true
        });
        grant_wake_lock(webview);
        one_finger(webview);
    }

    /// Answers WebKit's permission check for the wake lock with granted. Without an answer WebKit takes it as "ask", and
    /// refuses the lock unless someone has just touched the screen: the app's request as it loads or wakes for music was
    /// refused, and the screen slept 10 s later.
    fn grant_wake_lock(webview: &WebView) {
        use gtk::glib::{gobject_ffi, prelude::*, translate::ToGlibPtr};
        use std::ffi::{c_char, c_int, c_void, CStr};

        // WebKitPermissionStateQuery has no Rust binding yet.
        extern "C" {
            fn webkit_permission_state_query_get_name(query: *mut c_void) -> *const c_char;
            fn webkit_permission_state_query_finish(query: *mut c_void, state: c_int);
        }
        const GRANTED: c_int = 0;

        webview.connect_local("query-permission-state", false, |args| {
            let value = args.get(1)?;
            // SAFETY: the signal's second argument is the WebKitPermissionStateQuery, alive while the handler runs.
            let handled = unsafe {
                let query = gobject_ffi::g_value_get_boxed(value.to_glib_none().0) as *mut c_void;
                let name = CStr::from_ptr(webkit_permission_state_query_get_name(query));
                if name.to_bytes() == b"screen-wake-lock" {
                    webkit_permission_state_query_finish(query, GRANTED);
                    true
                } else {
                    false
                }
            };
            Some(handled.to_value())
        });
    }

    /// Passes WebKit one finger at a time. WebKitGTK zooms the page on a two-finger pinch, whatever the page does with
    /// the touches, and leaves it zoomed; the app has no two-finger gestures, so the second finger is simply dropped.
    fn one_finger(webview: &WebView) {
        use gtk::gdk::EventType;
        use gtk::glib::{translate::ToGlibPtr, Propagation};
        use gtk::prelude::*;
        use std::cell::Cell;

        // The finger that is down, by its event sequence (a pointer GDK keeps for as long as the finger is down).
        let first: Cell<Option<usize>> = Cell::new(None);
        webview.connect_touch_event(move |_, event| {
            let Some(sequence) = event.event_sequence() else {
                return Propagation::Proceed;
            };
            let id = ToGlibPtr::<*mut gtk::gdk::ffi::GdkEventSequence>::to_glib_none(&sequence).0 as usize;
            match event.event_type() {
                EventType::TouchBegin if first.get().is_none() => first.set(Some(id)),
                EventType::TouchEnd | EventType::TouchCancel if first.get() == Some(id) => first.set(None),
                _ if first.get() == Some(id) => {}
                _ => return Propagation::Stop,
            }
            Propagation::Proceed
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn allows_the_app_and_listed_sites_only() {
        let app = url("http://127.0.0.1:7341/?v=1");
        assert!(allowed(&app, &url("http://127.0.0.1:7341/settings")));
        assert!(allowed(&app, &url("https://accounts.spotify.com/authorize")));
        assert!(allowed(&app, &url("https://countdown.run/register")));
        assert!(allowed(&app, &url("https://api.countdown.build/x")));
        assert!(allowed(&app, &url("about:blank")));
        assert!(!allowed(&app, &url("http://127.0.0.1:9222/")));
        assert!(!allowed(&app, &url("http://accounts.spotify.com/")));
        assert!(!allowed(&app, &url("https://evilspotify.com/")));
        assert!(!allowed(&app, &url("https://accounts.google.com/")));
    }
}
