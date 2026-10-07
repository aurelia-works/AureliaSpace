//! Discord Rich Presence. The frontend pushes the presence it wants (computed from agent
//! state); a worker thread owns the IPC connection so Discord being slow, absent or
//! restarted never touches the UI thread. Connection failures are silent and retried.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

const RETRY: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub client_id: String,
    pub details: String,
    pub state: Option<String>,
    /// Unix seconds the elapsed-time counter counts from.
    pub started_at: Option<i64>,
}

const LOGO_URL: &str = "https://raw.githubusercontent.com/aurelia-works/AureliaSpace/main/src-tauri/icons/128x128@2x.png";
const REPO_URL: &str = "https://github.com/aurelia-works/AureliaSpace";

enum Msg {
    Set(Option<Presence>),
}

#[derive(Default)]
pub struct DiscordState(Mutex<Option<Sender<Msg>>>);

fn apply(client: &mut DiscordIpcClient, p: &Presence) -> Result<(), discord_rich_presence::error::Error> {
    let mut a = activity::Activity::new()
        .details(&p.details)
        // Discord accepts an image URL here, so no assets need uploading to the dev portal.
        .assets(activity::Assets::new().large_image(LOGO_URL).large_text("AureliaSpace"))
        .buttons(vec![activity::Button::new("Get AureliaSpace", REPO_URL)]);
    if let Some(s) = p.state.as_deref().filter(|s| !s.is_empty()) {
        a = a.state(s);
    }
    if let Some(t) = p.started_at {
        a = a.timestamps(activity::Timestamps::new().start(t));
    }
    client.set_activity(a)
}

fn worker(rx: std::sync::mpsc::Receiver<Msg>) {
    let mut client: Option<(String, DiscordIpcClient)> = None;
    let mut want: Option<Presence> = None;
    loop {
        // Block for new state; on timeout, fall through to retry a pending connection.
        let timeout = if want.is_some() && client.is_none() { RETRY } else { Duration::from_secs(3600) };
        let mut dirty = match rx.recv_timeout(timeout) {
            Ok(Msg::Set(p)) => {
                let changed = p != want;
                want = p;
                changed
            }
            Err(RecvTimeoutError::Timeout) => true,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        // Drain bursts so only the latest presence is sent.
        while let Ok(Msg::Set(p)) = rx.try_recv() {
            dirty |= p != want;
            want = p;
        }
        if !dirty {
            continue;
        }
        let Some(p) = want.clone() else {
            if let Some((_, mut c)) = client.take() {
                let _ = c.clear_activity();
                let _ = c.close();
            }
            continue;
        };
        if client.as_ref().is_some_and(|(id, _)| *id != p.client_id) {
            if let Some((_, mut c)) = client.take() {
                let _ = c.close();
            }
        }
        if client.is_none() {
            let mut c = DiscordIpcClient::new(&p.client_id);
            if c.connect().is_err() {
                continue; // Discord not running: retried after RETRY
            }
            client = Some((p.client_id.clone(), c));
        }
        if let Some((_, c)) = client.as_mut() {
            if apply(c, &p).is_err() {
                // Connection died (Discord quit); reconnect on the next retry.
                client = None;
            }
        }
    }
}

/// Sets the presence, or clears it (and disconnects) when `presence` is null.
#[tauri::command]
pub fn discord_set(state: tauri::State<DiscordState>, presence: Option<Presence>) {
    let mut guard = state.0.lock().unwrap();
    let presence = presence.filter(|p| !p.client_id.trim().is_empty());
    if guard.is_none() {
        if presence.is_none() {
            return;
        }
        let (tx, rx) = channel();
        std::thread::spawn(move || worker(rx));
        *guard = Some(tx);
    }
    if let Some(tx) = guard.as_ref() {
        let _ = tx.send(Msg::Set(presence));
    }
}
