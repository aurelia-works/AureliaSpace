#!/bin/sh
# AureliaSpace: forwards Claude Code hook events to the app as one JSON line.
# Only status fields are kept; never blocks or alters Claude's behaviour.
event="$1"
if [ -z "$AURELIA_PANE_ID" ] || [ -z "$AURELIA_EVENTS_FILE" ]; then
  cat >/dev/null
  exit 0
fi
if command -v jq >/dev/null 2>&1; then
  payload=$(jq -c '{session_id, cwd, hook_event_name, notification_type, message, tool_name, transcript_path, model}' 2>/dev/null)
else
  cat >/dev/null
fi
[ -z "$payload" ] && payload='{}'
printf '{"pane":"%s","event":"%s","configDir":"%s","ts":%s,"payload":%s}\n' \
  "$AURELIA_PANE_ID" "$event" "${CLAUDE_CONFIG_DIR:-}" "$(date +%s)" "$payload" >> "$AURELIA_EVENTS_FILE"
exit 0
