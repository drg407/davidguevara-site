// Signaling relay URL (Cloudflare Worker) for 4-digit room codes.
// Empty string = relay disabled → the app falls back to copy-paste join codes.
// After deploying worker/relay.js, set e.g.:
//   "https://vr-calc-relay.<your-subdomain>.workers.dev"
// A ?relay=<url> URL parameter overrides the static value (test hook).
const STATIC_RELAY_URL = "https://vr-calc-relay.drg407.workers.dev";

const override = (typeof window !== 'undefined')
  ? new URLSearchParams(window.location.search).get('relay')
  : null;

export const RELAY_URL = (override && override.length > 0) ? override : STATIC_RELAY_URL;
