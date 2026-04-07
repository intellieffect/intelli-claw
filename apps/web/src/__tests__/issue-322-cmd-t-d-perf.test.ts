/**
 * #322: Cmd+T / Cmd+D perceived latency fix
 *
 * Symptom (2026-04-08):
 *   - Cmd+T (new topic dialog) felt sluggish — 400ms+ to even render the
 *     dialog, plus another 1s+ before the new tab appeared in chat-header.
 *   - Cmd+D (close topic) had the same delay closing the visible tab.
 *
 * Root cause (CDP-measured):
 *   1. `createSessionForAgent` did `await client.request("sessions.patch")`
 *      then `refreshSessions()` synchronously. The new tab was invisible
 *      until BOTH gateway round-trips finished (~600ms+ on busy stores).
 *   2. `useChat`'s sessionKey effect triggered `loadHistory()` for brand-new
 *      empty topics, doing a pointless `chat.history` round-trip.
 *   3. The agent-level backfill `useEffect` ran synchronously on every
 *      sessionKey transition, fetching 331 prior sessions + restoring 450
 *      messages from IndexedDB on the main thread (~1500ms blocking).
 *
 * Fix (this PR):
 *   A. createSessionForAgent: optimistic `upsertSession` + fire-and-forget
 *      `client.request("sessions.patch")`. UI updates in <50ms.
 *   B. loadHistory: honor `awf:skip-load:{sessionKey}` sentinel in
 *      sessionStorage so brand-new topics skip `chat.history` entirely.
 *   C. backfill useEffect: deferred via `requestIdleCallback` and cancelled
 *      via `cancelled` flag the moment sessionKey changes again. Main
 *      thread stays responsive during tab transitions.
 *   D. handleCloseTopic: optimistic local `patchSession` for every sibling
 *      so chat-header drops the tab on the next paint.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const CHAT_PANEL = fs.readFileSync(
  path.resolve(__dirname, "../components/chat/chat-panel.tsx"),
  "utf-8",
);
const HOOKS = fs.readFileSync(
  path.resolve(__dirname, "../lib/gateway/hooks.tsx"),
  "utf-8",
);

describe("#322 Cmd+T new-topic perceived latency", () => {
  it("createSessionForAgent does NOT await sessions.patch (fire-and-forget)", () => {
    // The function body must contain `client.request("sessions.patch"` WITHOUT
    // a preceding `await`. Match a window around the call.
    const match = CHAT_PANEL.match(
      /client\.request\(\s*"sessions\.patch"[\s\S]{0,200}/g,
    );
    expect(match).toBeTruthy();
    // The createSessionForAgent invocation should be the fire-and-forget one
    // — chained with `.catch(`, no `await` immediately before.
    const inCreate = CHAT_PANEL.match(
      /createSessionForAgent[\s\S]{0,1500}client\.request\(\s*"sessions\.patch"[\s\S]{0,200}\.catch/,
    );
    expect(inCreate).toBeTruthy();
  });

  it("createSessionForAgent calls upsertSession optimistically before setSessionKey", () => {
    // upsertSession must appear BEFORE setSessionKey in the same function.
    const fnBody = CHAT_PANEL.match(
      /createSessionForAgent[\s\S]+?refocusPanel\(\);/,
    );
    expect(fnBody).toBeTruthy();
    const body = fnBody![0];
    const upsertIdx = body.indexOf("upsertSession(");
    const setKeyIdx = body.indexOf("setSessionKey(");
    expect(upsertIdx).toBeGreaterThan(-1);
    expect(setKeyIdx).toBeGreaterThan(-1);
    expect(upsertIdx).toBeLessThan(setKeyIdx);
  });

  it("createSessionForAgent writes the skip-load sentinel BEFORE setSessionKey", () => {
    const fnBody = CHAT_PANEL.match(
      /createSessionForAgent[\s\S]+?refocusPanel\(\);/,
    );
    expect(fnBody).toBeTruthy();
    const body = fnBody![0];
    expect(body).toMatch(/sessionStorage\.setItem\(\s*`awf:skip-load:/);
    const sentinelIdx = body.indexOf("awf:skip-load:");
    const setKeyIdx = body.indexOf("setSessionKey(");
    expect(sentinelIdx).toBeLessThan(setKeyIdx);
  });

  it("useSessions exposes upsertSession", () => {
    expect(HOOKS).toMatch(/upsertSession/);
    expect(HOOKS).toMatch(/return\s*\{[^}]*upsertSession[^}]*\}/);
  });
});

describe("#322 loadHistory skip-load sentinel", () => {
  it("loadHistory consumes awf:skip-load:{sessionKey} and bails before chat.history", () => {
    // The skip-load sentinel must appear in hooks.tsx, AND the order across
    // the file must be: loadHistory definition → sentinel check → chat.history
    // call. Use absolute file offsets so we don't have to perfectly slice the
    // (very long) loadHistory body.
    const loadHistoryDeclIdx = HOOKS.indexOf("const loadHistory = useCallback");
    const sentinelIdx = HOOKS.indexOf("awf:skip-load:");
    const historyIdx = HOOKS.indexOf('"chat.history"');
    expect(loadHistoryDeclIdx).toBeGreaterThan(-1);
    expect(sentinelIdx).toBeGreaterThan(-1);
    expect(historyIdx).toBeGreaterThan(-1);
    // sentinel sits inside loadHistory and BEFORE the chat.history request
    expect(sentinelIdx).toBeGreaterThan(loadHistoryDeclIdx);
    expect(sentinelIdx).toBeLessThan(historyIdx);
    expect(HOOKS).toMatch(/sessionStorage\.removeItem\(skipKey\)/);
  });
});

describe("#322 backfill is deferred via requestIdleCallback", () => {
  it("backfill useEffect uses requestIdleCallback (or setTimeout fallback)", () => {
    // Find the backfill useEffect by its distinctive comment marker.
    const backfillBlock = HOOKS.match(
      /\/\/ Backfill previous session messages from API[\s\S]+?(?=\n\s*\/\/ Reload history on reconnect)/,
    );
    expect(backfillBlock).toBeTruthy();
    const body = backfillBlock![0];
    expect(body).toMatch(/requestIdleCallback/);
    // Must also have a cancellation flag to abort on sessionKey change.
    expect(body).toMatch(/let cancelled = false/);
    // Cleanup function must set cancelled = true.
    expect(body).toMatch(/cancelled = true/);
  });

  it("backfill aborts in-flight work when sessionKey changes (cancelled flag checks)", () => {
    const backfillBlock = HOOKS.match(
      /\/\/ Backfill previous session messages from API[\s\S]+?(?=\n\s*\/\/ Reload history on reconnect)/,
    );
    expect(backfillBlock).toBeTruthy();
    const body = backfillBlock![0];
    // Must check `cancelled` after at least 2 awaits (topics + listRes + loop).
    const cancelChecks = (body.match(/if\s*\(\s*cancelled\s*\)/g) || []).length;
    expect(cancelChecks).toBeGreaterThanOrEqual(3);
  });
});

describe("#322 handleCloseTopic optimistic update", () => {
  it("handleCloseTopic patches local state BEFORE awaiting any gateway round-trip", () => {
    // Find the handleCloseTopic function and confirm patchSession runs in the
    // synchronous prefix (before any `void (async () => { ...` block).
    const fnMatch = CHAT_PANEL.match(
      /const handleCloseTopic = useCallback\([\s\S]+?\[client, isConnected, sessions, refreshSessions, patchSession\][\s\S]*?\);/,
    );
    expect(fnMatch).toBeTruthy();
    const body = fnMatch![0];
    // patchSession should appear, AND it should be in a `for` loop over siblings.
    expect(body).toMatch(/for\s*\([^)]*siblings\)\s*\{[\s\S]*patchSession\(s\.key/);
    // The async background block runs AFTER the optimistic loop.
    const optimisticIdx = body.indexOf("patchSession(s.key");
    const asyncBlockIdx = body.indexOf("void (async");
    expect(optimisticIdx).toBeGreaterThan(-1);
    expect(asyncBlockIdx).toBeGreaterThan(-1);
    expect(optimisticIdx).toBeLessThan(asyncBlockIdx);
  });

  it("handleCloseTopic does NOT await refreshSessions in the synchronous path", () => {
    const fnMatch = CHAT_PANEL.match(
      /const handleCloseTopic = useCallback\([\s\S]+?\[client, isConnected, sessions, refreshSessions, patchSession\][\s\S]*?\);/,
    );
    expect(fnMatch).toBeTruthy();
    const body = fnMatch![0];
    // The synchronous prefix (before void async) must not contain `await refreshSessions`.
    const asyncIdx = body.indexOf("void (async");
    const syncPrefix = body.slice(0, asyncIdx);
    expect(syncPrefix).not.toMatch(/await\s+refreshSessions/);
  });
});
