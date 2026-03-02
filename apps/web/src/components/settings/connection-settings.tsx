import { useState, useEffect, useCallback } from "react";
import { Wifi, Key, Fingerprint, Server, Copy, Check, RotateCcw, Save } from "lucide-react";
import { useGateway, GATEWAY_CONFIG_STORAGE_KEY, DEFAULT_GATEWAY_URL } from "@/lib/gateway/hooks";
import { clearDeviceIdentity, getOrCreateDevice } from "@/lib/gateway/device-identity";
import { getSetupGuide, classifyError } from "@/lib/gateway/setup-guide";
import { STATUS_CONFIG } from "@/components/chat/connection-status";

interface ConnectionSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectionSettings({ open, onClose }: ConnectionSettingsProps) {
  const { client, state, error, updateConfig, serverVersion, serverCommit, gatewayUrl } = useGateway();

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load current values when opening
  useEffect(() => {
    if (!open) return;
    // Read from localStorage or fallback to env
    try {
      const saved = localStorage.getItem(GATEWAY_CONFIG_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setUrl(parsed.url || "");
        setToken(parsed.token || "");
      } else {
        setUrl(import.meta.env.VITE_GATEWAY_URL || DEFAULT_GATEWAY_URL);
        setToken(import.meta.env.VITE_GATEWAY_TOKEN || "");
      }
    } catch {
      setUrl(gatewayUrl);
      setToken("");
    }

    // Load device ID
    getOrCreateDevice()
      .then((d) => setDeviceId(d.id))
      .catch(() => setDeviceId(null));
  }, [open, gatewayUrl]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSave = useCallback(() => {
    if (!url.trim()) return;
    setSaving(true);
    updateConfig(url.trim(), token.trim());
    setTimeout(() => {
      setSaving(false);
      onClose();
    }, 300);
  }, [url, token, updateConfig, onClose]);

  const handleResetDevice = useCallback(async () => {
    await clearDeviceIdentity();
    setDeviceId(null);
    // Reconnect with fresh identity
    if (client) {
      client.disconnect();
      client.connect();
    }
    // Reload device ID
    try {
      const d = await getOrCreateDevice();
      setDeviceId(d.id);
    } catch { /* ignore */ }
  }, [client]);

  const handleCopy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  }, []);

  if (!open) return null;

  const classified = error ? classifyError(error.code, error.message) : null;
  const guideText = classified
    ? getSetupGuide(classified.guideKey, { origin: window.location.origin, deviceId: deviceId || undefined, gatewayUrl: url })
    : null;

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,480px)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <Wifi size={14} className="text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">연결 설정</span>
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
            state === "connected" ? "bg-emerald-900/50 text-emerald-400" : "bg-red-900/50 text-red-400"
          }`}>
            {STATUS_CONFIG[state].label}
          </span>
        </div>

        {/* Gateway URL */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
            <Server size={10} /> Gateway URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="wss://your-gateway.example.com"
            className="w-full rounded-md bg-zinc-800/60 px-2.5 py-1.5 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-zinc-700/50 focus:ring-amber-600/50"
          />
        </div>

        {/* Token */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
            <Key size={10} /> Token
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Gateway operator token"
            className="w-full rounded-md bg-zinc-800/60 px-2.5 py-1.5 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-zinc-700/50 focus:ring-amber-600/50"
          />
        </div>

        {/* Device Identity */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
              <Fingerprint size={10} /> Device ID
            </label>
            <button
              onClick={handleResetDevice}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            >
              <RotateCcw size={9} /> 초기화
            </button>
          </div>
          <div className="mt-1 rounded-md bg-zinc-800/40 px-2.5 py-1.5 text-[11px] font-mono text-zinc-400 select-all">
            {deviceId || "(생성 중...)"}
          </div>
        </div>

        {/* Server Info (when connected) */}
        {state === "connected" && (serverVersion || serverCommit) && (
          <div className="border-b border-zinc-800 px-4 py-2">
            <div className="flex items-center gap-3 text-[10px] text-zinc-500">
              {serverVersion && <span>Version: <span className="text-zinc-400">{serverVersion}</span></span>}
              {serverCommit && <span>Commit: <span className="text-zinc-400 font-mono">{serverCommit.slice(0, 8)}</span></span>}
            </div>
          </div>
        )}

        {/* Error + Setup Guide */}
        {error && (
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="mb-2 rounded-md bg-red-950/40 border border-red-900/30 px-3 py-2">
              <div className="text-[11px] font-medium text-red-400 mb-0.5">
                {error.code || "error"}
              </div>
              <div className="text-[11px] text-red-300/80">
                {error.message}
              </div>
            </div>

            {guideText && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-medium text-zinc-500">설정 가이드 (AI agent에 전달)</span>
                  <button
                    onClick={() => handleCopy(guideText, "guide")}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-amber-500 hover:bg-zinc-800 transition-colors"
                  >
                    {copied === "guide" ? <Check size={10} /> : <Copy size={10} />}
                    {copied === "guide" ? "복사됨" : "복사"}
                  </button>
                </div>
                <pre className="max-h-40 overflow-y-auto rounded-md bg-zinc-800/40 px-3 py-2 text-[10px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
                  {guideText}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* General Setup Guide (when no specific error) */}
        {!error && state !== "connected" && (
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-zinc-500">설정 가이드 (AI agent에 전달)</span>
              <button
                onClick={() => handleCopy(
                  getSetupGuide("general_setup", { origin: window.location.origin, gatewayUrl: url }),
                  "general"
                )}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-amber-500 hover:bg-zinc-800 transition-colors"
              >
                {copied === "general" ? <Check size={10} /> : <Copy size={10} />}
                {copied === "general" ? "복사됨" : "복사"}
              </button>
            </div>
            <pre className="max-h-40 overflow-y-auto rounded-md bg-zinc-800/40 px-3 py-2 text-[10px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
              {getSetupGuide("general_setup", { origin: window.location.origin, gatewayUrl: url })}
            </pre>
          </div>
        )}

        {/* App Version */}
        <div className="border-b border-zinc-800 px-4 py-2">
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span>App: <span className="text-zinc-400 font-mono">v{import.meta.env.VITE_APP_VERSION || "0.0.0"}</span></span>
            <span>·</span>
            <span className="text-zinc-500">{import.meta.env.MODE}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 py-3">
          <button
            onClick={handleSave}
            disabled={saving || !url.trim()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-amber-600/80 py-2 text-[12px] font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            <Save size={12} />
            {saving ? "저장 중..." : "저장 + 재연결"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-zinc-800 px-4 py-2 text-[12px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
