#!/bin/sh
# Xcode Cloud - build the Capacitor web bundle before Archive.
# Runs on Apple's Macs so you can ship iOS updates from Windows.
set -euo pipefail

echo "=== ci_post_clone: Student Padel Ireland (Capacitor) ==="

cd "${CI_PRIMARY_REPOSITORY_PATH}/frontend"

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1

# Capacitor 8 needs Node 22+
ensure_node_22() {
  if command -v node >/dev/null 2>&1; then
    MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "${MAJOR}" -ge 22 ]; then
      return 0
    fi
    echo "Node $(node -v) is too old; installing Node 22…"
  else
    echo "Installing Node via Homebrew…"
  fi
  brew install node@22
  brew link --overwrite --force node@22 || true
  export PATH="$(brew --prefix node@22)/bin:${PATH}"
}

ensure_node_22

echo "node $(node -v) / npm $(npm -v)"

# Prefer Xcode Cloud workflow env vars; fall back to production defaults.
export VITE_API_URL="${VITE_API_URL:-https://student-padel-ireland.onrender.com}"
export VITE_WEB_ORIGIN="${VITE_WEB_ORIGIN:-https://studentpadel.ie}"

echo "VITE_API_URL=${VITE_API_URL}"
echo "VITE_WEB_ORIGIN=${VITE_WEB_ORIGIN}"

npm ci
npm run build:native

echo "=== ci_post_clone complete ==="
