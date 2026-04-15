/**
 * Phase 2 regression guard:
 *   Active chat code must not issue OpenClaw-gateway RPCs.
 *
 * These RPC names are OpenClaw-specific and violate the Channel contract:
 *   - `sessions.patch` / `sessions.delete` — webchat clients are forbidden
 *     from mutating sessions; use `chat.send` directives or plugin tools.
 *   - `chat.send` — replaced by `ChannelClient.send()` / `upload()`.
 *
 * The gateway library keeps these strings in its own source because it is
 * dead code pending Phase 3 deletion. This test scans only the active client
 * surface (App/main/channel-chat-view/the shared channel module).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const WEB_SRC = resolve(__dirname, "..");
const SHARED_SRC = resolve(__dirname, "../../../../packages/shared/src");

const ACTIVE_FILES = [
  resolve(WEB_SRC, "main.tsx"),
  resolve(WEB_SRC, "App.tsx"),
  resolve(WEB_SRC, "components/chat/channel-chat-view.tsx"),
  resolve(SHARED_SRC, "channel/protocol.ts"),
  resolve(SHARED_SRC, "channel/client.ts"),
  resolve(SHARED_SRC, "channel/hooks.tsx"),
  resolve(SHARED_SRC, "channel/index.ts"),
];

const FORBIDDEN_RPCS = ["sessions.patch", "sessions.delete", "chat.send"];

describe("active code must not call OpenClaw-gateway RPCs", () => {
  for (const path of ACTIVE_FILES) {
    it(`${path.replace(/.*intelli-claw\//, "")}: no forbidden RPC strings`, () => {
      const src = readFileSync(path, "utf8");
      for (const needle of FORBIDDEN_RPCS) {
        expect(src, `file contains forbidden RPC '${needle}'`).not.toContain(needle);
      }
    });
  }
});
