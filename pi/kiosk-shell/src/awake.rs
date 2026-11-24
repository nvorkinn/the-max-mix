//! Keeps the screen on while the app holds a wake lock.
//!
//! WebKitGTK turns the app's `navigator.wakeLock` into an `Inhibit` call on the session bus's org.freedesktop.ScreenSaver,
//! which nothing provides under Cage. So the shell provides it, and while any inhibit is held it holds a Wayland idle
//! inhibitor on its own window: Cage then reports no idle time, and swayidle (kiosk-session) leaves the screen on, as it
//! did for Chromium, whose wake lock reached Cage directly.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use glib::translate::ToGlibPtr;
use gtk::prelude::*;
use wayland_client::protocol::{wl_registry, wl_surface::WlSurface};
use wayland_client::{Connection, Dispatch, EventQueue, Proxy, QueueHandle};
use wayland_protocols::wp::idle_inhibit::zv1::client::{
    zwp_idle_inhibit_manager_v1::ZwpIdleInhibitManagerV1, zwp_idle_inhibitor_v1::ZwpIdleInhibitorV1,
};
use webkit2gtk::{gio, glib};

const BUS_NAME: &str = "org.freedesktop.ScreenSaver";
// Both paths the screen saver is known by; WebKit and other clients use one or the other.
const PATHS: &[&str] = &["/org/freedesktop/ScreenSaver", "/ScreenSaver"];
const INTERFACE: &str = r#"<node>
  <interface name="org.freedesktop.ScreenSaver">
    <method name="Inhibit">
      <arg type="s" name="application_name" direction="in"/>
      <arg type="s" name="reason_for_inhibit" direction="in"/>
      <arg type="u" name="cookie" direction="out"/>
    </method>
    <method name="UnInhibit">
      <arg type="u" name="cookie" direction="in"/>
    </method>
  </interface>
</node>"#;

/// The shell's state for the bus callbacks, which GLib runs on GTK's main thread, like everything else here.
struct State {
    inhibitor: Inhibitor,
    next_cookie: u32,
    /// The inhibits held, by cookie, with the bus name that holds each: when a holder leaves the bus (a crashed web
    /// process), its inhibits go with it, so the screen can still sleep.
    held: HashMap<u32, String>,
    watched: HashSet<String>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with_state<T>(f: impl FnOnce(&mut State) -> T) -> Option<T> {
    STATE.with(|state| state.borrow_mut().as_mut().map(f))
}

/// Starts serving the screen saver on the session bus for `window`. Call on GTK's main thread.
pub fn start(window: gtk::ApplicationWindow) {
    STATE.with(|state| {
        *state.borrow_mut() = Some(State {
            inhibitor: Inhibitor::new(window),
            next_cookie: 0,
            held: HashMap::new(),
            watched: HashSet::new(),
        })
    });
    let owner = gio::bus_own_name(
        gio::BusType::Session,
        BUS_NAME,
        gio::BusNameOwnerFlags::REPLACE,
        |connection, _| {
            let node = gio::DBusNodeInfo::for_xml(INTERFACE).expect("the screen saver interface parses");
            let interface = node.lookup_interface(BUS_NAME).expect("the interface is in the node");
            for path in PATHS {
                let registered = connection.register_object(
                    path,
                    &interface,
                    |connection, sender, _, _, method, params, invocation| {
                        let reply = call(&connection, sender, method, &params);
                        invocation.return_value(reply.as_ref());
                    },
                    |_, _, _, _, _| ().to_variant(),
                    |_, _, _, _, _, _| false,
                );
                if let Err(error) = registered {
                    eprintln!("kiosk-shell: could not serve the screen saver at {path}: {error}");
                }
            }
        },
        |_, _| {},
        |_, _| eprintln!("kiosk-shell: could not own {BUS_NAME}; the app's wake lock will not keep the screen on"),
    );
    // Owned for as long as the shell runs.
    std::mem::forget(owner);
}

fn call(connection: &gio::DBusConnection, sender: &str, method: &str, params: &glib::Variant) -> Option<glib::Variant> {
    let sender = sender.to_string();
    match method {
        "Inhibit" => with_state(|state| {
            state.next_cookie += 1;
            let cookie = state.next_cookie;
            state.held.insert(cookie, sender.clone());
            if state.watched.insert(sender.clone()) {
                let holder = sender.clone();
                gio::bus_watch_name_on_connection(
                    connection,
                    &holder,
                    gio::BusNameWatcherFlags::NONE,
                    |_, _, _| {},
                    move |_, _| {
                        with_state(|state| {
                            state.held.retain(|_, holder| *holder != sender);
                            let on = !state.held.is_empty();
                            state.inhibitor.set(on);
                        });
                    },
                );
            }
            state.inhibitor.set(true);
            (cookie,).to_variant()
        }),
        "UnInhibit" => {
            let (cookie,) = params.get::<(u32,)>().unwrap_or_default();
            with_state(|state| {
                state.held.remove(&cookie);
                let on = !state.held.is_empty();
                state.inhibitor.set(on);
            });
            None
        }
        _ => None,
    }
}

/// The Wayland idle inhibitor on the shell's window, made on GTK's own Wayland connection.
struct Inhibitor {
    window: gtk::ApplicationWindow,
    wayland: Option<Wayland>,
    on: bool,
}

struct Wayland {
    connection: Connection,
    queue: EventQueue<Globals>,
    globals: Globals,
    surface: WlSurface,
    inhibitor: Option<ZwpIdleInhibitorV1>,
}

#[derive(Default)]
struct Globals {
    manager: Option<ZwpIdleInhibitManagerV1>,
}

impl Inhibitor {
    fn new(window: gtk::ApplicationWindow) -> Self {
        Inhibitor {
            window,
            wayland: None,
            on: false,
        }
    }

    fn set(&mut self, on: bool) {
        if on == self.on {
            return;
        }
        self.on = on;
        if self.wayland.is_none() {
            self.wayland = Wayland::connect(&self.window);
        }
        let Some(wayland) = self.wayland.as_mut() else {
            eprintln!("kiosk-shell: no Wayland idle inhibitor; the screen may sleep while the app holds a wake lock");
            return;
        };
        if on {
            if let Some(manager) = &wayland.globals.manager {
                wayland.inhibitor = Some(manager.create_inhibitor(&wayland.surface, &wayland.queue.handle(), ()));
            }
        } else if let Some(inhibitor) = wayland.inhibitor.take() {
            inhibitor.destroy();
        }
        let _ = wayland.connection.flush();
        eprintln!("kiosk-shell: screen kept on: {on}");
    }
}

impl Wayland {
    fn connect(window: &gtk::ApplicationWindow) -> Option<Self> {
        let gdk_window = window.window()?;
        let display = gdk_window.display();
        // SAFETY: GDK's Wayland backend owns these for the life of the window, which outlives the shell's use of them.
        let (display_ptr, surface_ptr) = unsafe {
            let display_ptr = gdk_wayland_sys::gdk_wayland_display_get_wl_display(
                ToGlibPtr::<*mut gtk::gdk::ffi::GdkDisplay>::to_glib_none(&display).0 as *mut _,
            ) as *mut std::ffi::c_void;
            let surface_ptr = gdk_wayland_sys::gdk_wayland_window_get_wl_surface(
                ToGlibPtr::<*mut gtk::gdk::ffi::GdkWindow>::to_glib_none(&gdk_window).0 as *mut _,
            ) as *mut std::ffi::c_void;
            (display_ptr, surface_ptr)
        };
        if display_ptr.is_null() || surface_ptr.is_null() {
            return None;
        }
        // SAFETY: as above; GDK keeps the display open while the shell runs.
        let backend = unsafe { wayland_backend::client::Backend::from_foreign_display(display_ptr.cast()) };
        let connection = Connection::from_backend(backend);
        // SAFETY: the pointer is a live wl_surface proxy owned by GDK.
        let surface_id =
            unsafe { wayland_backend::client::ObjectId::from_ptr(WlSurface::interface(), surface_ptr.cast()) }.ok()?;
        let surface = WlSurface::from_id(&connection, surface_id).ok()?;
        let mut queue = connection.new_event_queue();
        let mut globals = Globals::default();
        connection.display().get_registry(&queue.handle(), ());
        queue.roundtrip(&mut globals).ok()?;
        if globals.manager.is_none() {
            eprintln!("kiosk-shell: the compositor has no idle inhibit protocol");
        }
        Some(Wayland {
            connection,
            queue,
            globals,
            surface,
            inhibitor: None,
        })
    }
}

impl Dispatch<wl_registry::WlRegistry, ()> for Globals {
    fn event(
        globals: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        queue: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global { name, interface, .. } = event {
            if interface == ZwpIdleInhibitManagerV1::interface().name {
                globals.manager = Some(registry.bind(name, 1, queue, ()));
            }
        }
    }
}

impl Dispatch<ZwpIdleInhibitManagerV1, ()> for Globals {
    fn event(
        _: &mut Self,
        _: &ZwpIdleInhibitManagerV1,
        _: <ZwpIdleInhibitManagerV1 as Proxy>::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<ZwpIdleInhibitorV1, ()> for Globals {
    fn event(
        _: &mut Self,
        _: &ZwpIdleInhibitorV1,
        _: <ZwpIdleInhibitorV1 as Proxy>::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}
