#!/bin/zsh
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ ! -d node_modules ]]; then
  npm ci
fi
if [[ ! -f dist/index.html ]]; then
  npm run build
fi
exec npm start
