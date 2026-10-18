#!/bin/sh
# AureliaSpace: forwards Claude Code hook events to the app as one JSON line.
# Only status fields are kept; never blocks or alters Claude's behaviour.
event="$1"
if [ -z "$AURELIA_PANE_ID" ] || [ -z "$AURELIA_EVENTS_FILE" ]; then
  cat >/dev/null
  exit 0
fi
if command -v jq >/dev/null 2>&1; then
  # tool_input keeps only what the risk tags read (lib/risk.ts): a command, a path or a URL.
  payload=$(jq -c '{session_id, cwd, hook_event_name, notification_type, message, tool_name, tool_input: (if (.tool_input|type) == "object" then (.tool_input | {command: (.command // null | if type == "string" then .[0:500] else null end), file_path: (.file_path // .notebook_path // null), url: (.url // null), path: (.path // null)} | with_entries(select(.value != null))) else null end), transcript_path, model, permission_mode, prompt: (.prompt // null | if type == "string" then .[0:200] else null end), error, error_details, last_assistant_message: (.last_assistant_message // null | if type == "string" then .[0:400] else . end)}' 2>/dev/null)
else
  cat >/dev/null
fi
[ -z "$payload" ] && payload='{}'
printf '{"pane":"%s","event":"%s","configDir":"%s","ts":%s,"payload":%s}\n' \
  "$AURELIA_PANE_ID" "$event" "${CLAUDE_CONFIG_DIR:-}" "$(date +%s)" "$payload" >> "$AURELIA_EVENTS_FILE"
exit 0
