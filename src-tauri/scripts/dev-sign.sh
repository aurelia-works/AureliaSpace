#!/bin/sh
# Cargo runner for `tauri dev`: signs the freshly built binary with the same identity
# and identifier as the bundled app before running it. Ad-hoc signatures change on
# every build, so macOS would forget folder-access and Keychain grants each time.
bin="$1"
codesign --force --sign "Apple Development" --identifier space.aurelia.terminal "$bin" 2>/dev/null ||
  echo "[aurelia] dev-sign: no 'Apple Development' identity; running ad-hoc signed" >&2
exec "$@"
