#!/bin/zsh
set -e
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  echo 'Установите Node.js 22.12+ или 24 LTS и запустите файл снова.'
  exit 1
fi
exec node scripts/launch.mjs --open
