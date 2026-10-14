// Prevents an extra console window on Windows in release; harmless on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude panes start this same binary as their MCP server (see subagents.rs).
    match std::env::args().nth(1).as_deref() {
        Some("mcp") => return aurelia_space_lib::serve_mcp(),
        // The terminal host the app starts in the background (see ptyhost.rs).
        Some("pty-host") => return aurelia_space_lib::serve_pty_host(),
        _ => {}
    }
    aurelia_space_lib::run()
}
