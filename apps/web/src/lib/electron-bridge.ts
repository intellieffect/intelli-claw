/**
 * Thin façade over the Electron preload bridge.
 *
 * In the browser context the global is `undefined` and helpers return null —
 * components fall back to the manual `?channel=<port>` workflow.
 */

export interface ManagedSessionInfo {
  port: number;
  uuid: string | null;
  cwd: string;
  pid: number;
  startedAt: number;
}

interface ElectronBridge {
  platform: string;
  electronVersion: string;
  session: {
    spawn: (opts: { uuid?: string; cwd: string }) => Promise<ManagedSessionInfo>;
    list: () => Promise<ManagedSessionInfo[]>;
    stop: (port: number) => Promise<void>;
    onChanged: (cb: (snap: ManagedSessionInfo[]) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

export function getElectronBridge(): ElectronBridge | null {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}

export function isElectron(): boolean {
  return getElectronBridge() !== null;
}
