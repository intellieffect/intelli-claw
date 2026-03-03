/**
 * Mock GatewayClient factory for testing hooks that depend on useGateway().
 *
 * Provides a minimal mock that mirrors the real GatewayClient public API
 * while allowing test code to emit events and control request responses.
 */
import { vi, type Mock } from "vitest";
import type { EventFrame } from "@intelli-claw/shared";

type EventHandler = (frame: EventFrame) => void;
type StateHandler = (state: string) => void;

export interface MockClient {
  request: Mock;
  onEvent: Mock;
  onStateChange: Mock;
  mainSessionKey: string;
  /** Emit an event to all registered handlers */
  emitEvent: (frame: EventFrame) => void;
  /** Emit state change to all registered handlers */
  emitStateChange: (state: string) => void;
  /** Get currently registered event handlers (for inspection) */
  getEventHandlers: () => Set<EventHandler>;
  /** Get currently registered state handlers (for inspection) */
  getStateHandlers: () => Set<StateHandler>;
}

/**
 * Create a mock GatewayClient instance.
 *
 * @param sessionKey - The mainSessionKey to set on the client
 * @returns MockClient with controllable event emission
 */
export function createMockClient(sessionKey = "test:agent"): MockClient {
  const eventHandlers = new Set<EventHandler>();
  const stateHandlers = new Set<StateHandler>();

  const client: MockClient = {
    request: vi.fn().mockResolvedValue({}),
    onEvent: vi.fn((handler: EventHandler) => {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    }),
    onStateChange: vi.fn((handler: StateHandler) => {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    }),
    mainSessionKey: sessionKey,
    emitEvent(frame: EventFrame) {
      for (const handler of eventHandlers) {
        handler(frame);
      }
    },
    emitStateChange(state: string) {
      for (const handler of stateHandlers) {
        handler(state);
      }
    },
    getEventHandlers: () => eventHandlers,
    getStateHandlers: () => stateHandlers,
  };

  return client;
}

/**
 * Create a mock useGateway() return value.
 *
 * @param overrides - Override specific fields
 * @returns Object matching useGateway() return shape
 */
export function createMockGatewayContext(overrides?: {
  client?: MockClient | null;
  state?: string;
  error?: string | null;
}) {
  const client = overrides?.client ?? createMockClient();
  return {
    client,
    state: overrides?.state ?? "connected",
    error: overrides?.error ?? null,
  };
}
