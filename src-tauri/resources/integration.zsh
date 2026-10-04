# AureliaSpace shell integration: emits OSC markers the terminal uses to build
# command blocks.
#   OSC 133;A        prompt start
#   OSC 133;C        command output start
#   OSC 133;D;<code> command finished
#   OSC 6973;cmd;<base64>  command text
#   OSC 6973;cwd;<base64>  working directory
[[ -n "$_AURELIA_LOADED" ]] && return
typeset -g _AURELIA_LOADED=1
typeset -g _aurelia_running=

_aurelia_b64() { builtin printf '%s' "$1" | command base64 | command tr -d '\n' }

_aurelia_precmd() {
  local ret=$?
  if [[ -n "$_aurelia_running" ]]; then
    builtin printf '\e]133;D;%s\a' "$ret"
    _aurelia_running=
  fi
  builtin printf '\e]6973;cwd;%s\a' "$(_aurelia_b64 "$PWD")"
  builtin printf '\e]133;A\a'
}

_aurelia_preexec() {
  _aurelia_running=1
  builtin printf '\e]6973;cmd;%s\a\e]133;C\a' "$(_aurelia_b64 "$1")"
}

# Runs on the first prompt, after the user's rc files, so our precmd goes first
# (it must see the command's exit status) even if the rc rewrote the hook arrays.
_aurelia_install() {
  precmd_functions=(${precmd_functions:#_aurelia_install})
  precmd_functions=(_aurelia_precmd ${precmd_functions:#_aurelia_precmd})
  preexec_functions=(${preexec_functions:#_aurelia_preexec} _aurelia_preexec)
  _aurelia_precmd
}
typeset -ga precmd_functions preexec_functions
precmd_functions+=(_aurelia_install)

# Route every `claude` started in this pane through the AureliaSpace hook settings,
# so the agent panel can track its status.
if [[ -n "$AURELIA_CLAUDE_SETTINGS" ]]; then
  claude() { command claude --settings "$AURELIA_CLAUDE_SETTINGS" "$@" }
fi
