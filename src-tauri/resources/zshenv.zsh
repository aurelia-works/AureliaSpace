# AureliaSpace zsh bootstrap. ZDOTDIR points here only long enough to load this file:
# restore the user's ZDOTDIR, source their .zshenv, then load the integration.
# zsh goes on to read the user's own .zprofile/.zshrc/.zlogin as usual.
if [[ -n "${AURELIA_ORIG_ZDOTDIR+X}" ]]; then
  'builtin' 'export' ZDOTDIR="$AURELIA_ORIG_ZDOTDIR"
  'builtin' 'unset' 'AURELIA_ORIG_ZDOTDIR'
else
  'builtin' 'unset' 'ZDOTDIR'
fi
{
  'builtin' 'typeset' _aurelia_file="${ZDOTDIR-$HOME}/.zshenv"
  [[ ! -r "$_aurelia_file" ]] || 'builtin' 'source' '--' "$_aurelia_file"
} always {
  if [[ -o 'interactive' && -r "$AURELIA_ZSH_INTEGRATION" ]]; then
    'builtin' 'source' '--' "$AURELIA_ZSH_INTEGRATION"
  fi
  'builtin' 'unset' '_aurelia_file'
}
