/**
 * Phase 2 regression guard:
 *   The active client entrypoints (main.tsx → App.tsx → channel-chat-view.tsx)
 *   must NOT import the legacy OpenClaw-gateway surface.
 *
 * The gateway modules are still in the tree as dead code pending Phase 3
 * deletion, so this test pins the boundary at the call site rather than at
 * the package level. Once the gateway modules are removed, this test becomes
 * mostly redundant but keeps the intent documented.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const ACTIVE_ENTRYPOINTS = [
  "main.tsx",
  "App.tsx",
  "components/chat/channel-chat-view.tsx",
];

const FORBIDDEN_IMPORTS = [
  "@/lib/gateway",
  // Gateway-era named exports from the shared package that must not leak into
  // the active entrypoints. This list is intentionally permissive — it's the
  // symbols that only make sense in the OpenClaw world.
  "GatewayProvider",
  "useGateway",
  "useAgents",
  "GatewayClient",
  "NodeGatewayClient",
  "initCryptoAdapter",
  "buildDeviceAuthPayload",
  "signChallenge",
];

describe("active entrypoints must not depend on the OpenClaw gateway surface", () => {
  for (const relPath of ACTIVE_ENTRYPOINTS) {
    it(`${relPath}: no forbidden gateway imports`, () => {
      const src = readFileSync(resolve(ROOT, relPath), "utf8");
      for (const needle of FORBIDDEN_IMPORTS) {
        expect(src, `${relPath} contains forbidden '${needle}'`).not.toContain(needle);
      }
    });
  }
});
