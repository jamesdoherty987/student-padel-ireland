#!/bin/sh
# Xcode Cloud - build the Capacitor web bundle before Archive.
# Runs on Apple's Macs so you can ship iOS updates from Windows.
set -euo pipefail

echo "=== ci_post_clone: Student Padel Ireland (Capacitor) ==="

cd "${CI_PRIMARY_REPOSITORY_PATH}/frontend"

# Capacitor 8 needs Node 22+
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node via Homebrew…"
  brew install node@22
  brew link --overwrite --force node@22 || true
  export PATH="$(brew --prefix node@22)/bin:${PATH}"
else
  MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "${MAJOR}" -lt 22 ]; then
    echo "Node $(node -v) is too old; installing Node 22…"
    brew install node@22
    brew link --overwrite --force node@22 || true
    export PATH="$(brew --prefix node@22)/bin:${PATH}"
  fi
fi

echo "node $(node -v) / npm $(npm -v)"

# Prefer Xcode Cloud workflow env vars; fall back to production defaults.
export VITE_API_URL="${VITE_API_URL:-https://student-padel-ireland.onrender.com}"
export VITE_WEB_ORIGIN="${VITE_WEB_ORIGIN:-https://studentpadel.ie}"

echo "VITE_API_URL=${VITE_API_URL}"
echo "VITE_WEB_ORIGIN=${VITE_WEB_ORIGIN}"

npm ci
npm run build:native

echo "=== ci_post_clone complete ==="
