#!/bin/bash
# intelli-claw Dev Server — Vite only (port 4000)
#
# The Claude Code channel plugin (plugins/intelli-claw-channel) is expected to
# be running on http://127.0.0.1:8790 (default). Start it separately in another
# terminal:
#
#   claude --dangerously-load-development-channels plugin:intelli-claw-channel@<marketplace>
#
# For purely local development without Claude Code, you can run the plugin's
# HTTP server directly:
#
#   cd plugins/intelli-claw-channel && bun server.ts
#
# The plugin prints its URL to stderr on startup.

set -e
cd "$(dirname "$0")/.."

# Kill any existing Vite dev server for this project.
pkill -f "vite.*intelli-claw" 2>/dev/null || true
sleep 1

# Start Vite dev server in the foreground so Ctrl-C cleans up.
echo "Dev server starting on http://localhost:4000"
echo "  (expects intelli-claw-channel at \$VITE_CHANNEL_URL — default http://127.0.0.1:8790)"
exec pnpm --filter @intelli-claw/web dev --port 4000 --strictPort
