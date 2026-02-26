/**
 * Session selection + UI state store using React context.
 */
import { createContext, useContext } from "react";

export interface SessionStore {
  activeSessionKey: string | null;
  setActiveSessionKey: (key: string | null) => void;
  openSessionPicker: () => void;
}

export const SessionContext = createContext<SessionStore>({
  activeSessionKey: null,
  setActiveSessionKey: () => {},
  openSessionPicker: () => {},
});

export function useSessionStore() {
  return useContext(SessionContext);
}
