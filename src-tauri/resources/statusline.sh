#!/bin/sh
# AureliaSpace: Claude Code status line bridge.
# Claude Code pipes its status JSON here (model, effort, context window, live rate
# limits read from API response headers, prompt-cache expiry, cost). The useful fields
# go to the app as one JSON line; then the user's own status line runs on the same
# input, so what they see in the prompt box doesn't change.
input=$(cat)
if [ -n "$AURELIA_PANE_ID" ] && [ -n "$AURELIA_EVENTS_FILE" ]; then
  payload=""
  if command -v jq >/dev/null 2>&1; then
    payload=$(printf '%s' "$input" | jq -c '{session_id, transcript_path, model, effort, context_window, rate_limits, prompt_cache, cost, exceeds_200k_tokens}' 2>/dev/null)
  fi
  # Without jq: JSON never holds a raw newline inside a string, so dropping them keeps it valid.
  [ -z "$payload" ] && payload=$(printf '%s' "$input" | tr -d '\r\n')
  [ -z "$payload" ] && payload='{}'
  printf '{"pane":"%s","event":"StatusLine","configDir":"%s","ts":%s,"payload":%s}\n' \
    "$AURELIA_PANE_ID" "${CLAUDE_CONFIG_DIR:-}" "$(date +%s)" "$payload" >> "$AURELIA_EVENTS_FILE"
fi
settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
user_cmd=""
if [ -r "$settings" ] && command -v jq >/dev/null 2>&1; then
  user_cmd=$(jq -r '.statusLine.command // empty' "$settings" 2>/dev/null)
fi
case "$user_cmd" in
  *aurelia-statusline.sh*) user_cmd="" ;;
esac
if [ -n "$user_cmd" ]; then
  printf '%s' "$input" | sh -c "$user_cmd"
fi
exit 0
