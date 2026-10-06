#!/usr/bin/env bash
# =============================================================================
# Build every AfriSend artifact with EAS and print the download links.
#
#   ./scripts/build-and-links.sh                 # preview APK + iOS + simulator
#   ./scripts/build-and-links.sh production      # store builds (AAB + IPA)
#   ./scripts/build-and-links.sh simulator       # iOS simulator only
#
# Requires: eas-cli logged in, `eas init` already run (projectId in app.json),
# and EXPO_PUBLIC_API_URL pointing at your deployed API.
# =============================================================================
set -euo pipefail

PROFILE="${1:-preview}"
case "$PROFILE" in
  preview)    PLATFORM=all   ;;
  simulator)  PLATFORM=ios   ;;
  production) PLATFORM=all   ;;
  development) PLATFORM=all  ;;
  *) echo "Unknown profile '$PROFILE' (preview | simulator | production | development)"; exit 1 ;;
esac

command -v eas >/dev/null 2>&1 || { echo "Install the CLI first: npm i -g eas-cli"; exit 1; }
[ -n "${EXPO_PUBLIC_API_URL:-}" ] || echo "WARNING: EXPO_PUBLIC_API_URL is not set; the app will use the default in app.json."

echo "▶ Building profile '$PROFILE' for '$PLATFORM' …"
eas build --profile "$PROFILE" --platform "$PLATFORM" --non-interactive --json > /tmp/afrisend-builds.json

echo
echo "Build pages (open one to download the artifact):"
node -e "
const builds = require('/tmp/afrisend-builds.json');
for (const b of builds) {
  console.log('  ' + b.platform.padEnd(8) + ' ' + b.buildDetailsPageUrl);
}
"

echo
echo "Waiting for artifacts (this can take 10-25 minutes)…"
node -e "
const { execSync } = require('child_process');
const builds = require('/tmp/afrisend-builds.json');
for (const b of builds) {
  try {
    execSync('eas build:view ' + b.id + ' --json > /tmp/afrisend-view.json', { stdio: 'ignore' });
    const view = require('/tmp/afrisend-view.json');
    const a = view.artifacts || {};
    const url = a.buildUrl || a.applicationArchiveUrl || a.archiveUrl;
    console.log('  ' + b.platform.padEnd(8) + (url || '(still building — check the build page)'));
  } catch (e) {
    console.log('  ' + b.platform.padEnd(8) + 'check ' + b.buildDetailsPageUrl);
  }
}
"
echo
echo "Done. Android preview artifacts are APKs (install directly); production Android is an AAB for the Play Store."
