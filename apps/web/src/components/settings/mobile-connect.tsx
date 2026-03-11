import { useState, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, Copy, Check, AlertTriangle, Link, QrCode } from "lucide-react";
import { useGateway, GATEWAY_CONFIG_STORAGE_KEY, DEFAULT_GATEWAY_URL } from "@/lib/gateway/hooks";

interface MobileConnectProps {
  open: boolean;
  onClose: () => void;
}

export function MobileConnect({ open, onClose }: MobileConnectProps) {
  const { gatewayUrl } = useGateway();
  const [copied, setCopied] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    if (!open) return;
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

  const qrPayload = JSON.stringify({ url, token });

  const deepLink = `intelli-claw://connect?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;

  const handleCopy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,440px)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <Smartphone size={14} className="text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">모바일 연결</span>
        </div>

        {/* Security Warning */}
        <div className="mx-4 mt-3 rounded-md bg-amber-950/40 border border-amber-900/30 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-400/90 leading-relaxed">
              QR 코드와 Deep Link에 Gateway 인증 토큰이 포함되어 있습니다. 신뢰할 수 있는 기기에서만 스캔하세요.
            </p>
          </div>
        </div>

        {/* QR Code */}
        <div className="flex flex-col items-center px-4 py-5">
          <div className="flex items-center gap-1.5 mb-3">
            <QrCode size={12} className="text-zinc-500" />
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              모바일 앱에서 스캔
            </span>
          </div>
          <div className="rounded-xl bg-white p-4">
            <QRCodeSVG
              value={qrPayload}
              size={200}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>
          <p className="mt-3 text-[10px] text-zinc-600 text-center max-w-[280px]">
            IntelliClaw 모바일 앱의 Settings &gt; QR로 연결에서 이 코드를 스캔하세요
          </p>
        </div>

        {/* Divider with "or" */}
        <div className="flex items-center gap-3 px-4">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-[10px] text-zinc-600">또는</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>

        {/* Deep Link */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Link size={12} className="text-zinc-500" />
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Deep Link 복사
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md bg-zinc-800/60 px-2.5 py-2 text-[11px] font-mono text-zinc-400 truncate ring-1 ring-zinc-700/50">
              {deepLink}
            </div>
            <button
              onClick={() => handleCopy(deepLink, "deeplink")}
              className="flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-700 transition-colors shrink-0"
            >
              {copied === "deeplink" ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied === "deeplink" ? "복사됨" : "복사"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-zinc-600">
            이 링크를 모바일 기기에서 열면 자동으로 Gateway에 연결됩니다
          </p>
        </div>

        {/* Close */}
        <div className="flex px-4 py-3 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="w-full rounded-md bg-zinc-800 py-2 text-[12px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
