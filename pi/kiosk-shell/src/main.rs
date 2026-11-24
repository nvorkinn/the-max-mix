//! The kiosk's window. Cage runs kiosk-session, which runs this with the app's address (http://127.0.0.1:7341/...):
//! one full-screen WebKit view on it, until the window closes. The app talks only to kiosk-audio; nothing talks to this.

use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

/// Sites the view may leave the app for, besides the app's own origin: Spotify's sign-in (with its challenge pages) and
/// the Web Playback SDK's frame, and countdown-server's pages (device registration, the settings site).
const ALLOWED_DOMAINS: &[&str] = &["spotify.com", "scdn.co", "countdown.run", "countdown.build"];

fn allowed(app: &Url, to: &Url) -> bool {
    if to.origin() == app.origin() || to.scheme() == "about" || to.scheme() == "blob" || to.scheme() == "data" {
        return true;
    }
    to.scheme() == "https"
        && to.host_str().is_some_and(|host| {
            ALLOWED_DOMAINS.iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
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
            window.with_webview(|webview| linux::configure(&webview.inner()))?;
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
