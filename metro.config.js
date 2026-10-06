// Default Expo Metro config. Kept in the repo so EAS builds use the same
// resolver settings as local development.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The admin console is a separate deployable (Render static site / Express
// static) and must never be bundled into the mobile app.
config.resolver.blockList = [
  /\/admin-dashboard\/.*/,
  /\/backend\/.*/,
  /\/supabase\/.*/,
];

module.exports = config;
