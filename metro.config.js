// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Force Metro to transpile packages that use private class fields
// (e.g. @supabase/supabase-js, @noble/hashes) which Hermes SDK 54 can't run natively
config.transformer = {
  ...config.transformer,
  unstable_allowRequireContext: true,
};

// Enable package exports resolution for @noble/hashes and similar packages
config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
};

module.exports = config;
