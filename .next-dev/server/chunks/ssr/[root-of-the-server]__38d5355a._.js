module.exports = [
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

module.exports = mod;
}),
"[project]/src/lib/gateway/protocol.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "makeReq",
    ()=>makeReq,
    "parseFrame",
    ()=>parseFrame
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$uuid$40$13$2e$0$2e$0$2f$node_modules$2f$uuid$2f$dist$2d$node$2f$v4$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__v4$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/uuid@13.0.0/node_modules/uuid/dist-node/v4.js [app-ssr] (ecmascript) <export default as v4>");
;
function makeReq(method, params) {
    return {
        type: "req",
        id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$uuid$40$13$2e$0$2e$0$2f$node_modules$2f$uuid$2f$dist$2d$node$2f$v4$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__v4$3e$__["v4"])(),
        method,
        params
    };
}
function parseFrame(data) {
    try {
        return JSON.parse(data);
    } catch  {
        return null;
    }
}
}),
"[project]/src/lib/gateway/client.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GatewayClient",
    ()=>GatewayClient
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$protocol$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/gateway/protocol.ts [app-ssr] (ecmascript)");
;
const REQUEST_TIMEOUT = 30_000;
const RECONNECT_DELAYS = [
    1000,
    2000,
    4000,
    8000,
    16000
];
class GatewayClient {
    ws = null;
    url;
    token;
    state = "disconnected";
    pending = new Map();
    eventHandlers = new Set();
    stateHandlers = new Set();
    reconnectAttempt = 0;
    reconnectTimer = null;
    intentionalClose = false;
    mainSessionKey = "";
    constructor(url, token){
        this.url = url;
        this.token = token;
    }
    // --- Public API ---
    connect() {
        if (this.ws && this.state !== "disconnected") return;
        this.intentionalClose = false;
        this.setState("connecting");
        try {
            this.ws = new WebSocket(this.url);
            this.ws.onopen = ()=>this.handleOpen();
            this.ws.onmessage = (e)=>this.handleMessage(e);
            this.ws.onclose = ()=>this.handleClose();
            this.ws.onerror = ()=>{}; // onclose will fire
        } catch  {
            this.handleClose();
        }
    }
    disconnect() {
        this.intentionalClose = true;
        this.clearReconnect();
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        this.rejectAll("Disconnected");
        this.setState("disconnected");
    }
    async request(method, params) {
        if (this.state !== "connected") {
            throw new Error(`Not connected (state: ${this.state})`);
        }
        const frame = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$protocol$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["makeReq"])(method, params);
        return new Promise((resolve, reject)=>{
            const timer = setTimeout(()=>{
                this.pending.delete(frame.id);
                reject(new Error(`Request timeout: ${method}`));
            }, REQUEST_TIMEOUT);
            this.pending.set(frame.id, {
                resolve: resolve,
                reject,
                timer
            });
            this.send(frame);
        });
    }
    onEvent(handler) {
        this.eventHandlers.add(handler);
        return ()=>this.eventHandlers.delete(handler);
    }
    onStateChange(handler) {
        this.stateHandlers.add(handler);
        return ()=>this.stateHandlers.delete(handler);
    }
    getState() {
        return this.state;
    }
    // --- Private ---
    send(frame) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(frame));
        }
    }
    setState(state) {
        if (this.state === state) return;
        this.state = state;
        this.stateHandlers.forEach((h)=>h(state));
    }
    handleOpen() {
        this.setState("authenticating");
    // Wait for connect.challenge
    }
    handleMessage(e) {
        const frame = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$protocol$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["parseFrame"])(typeof e.data === "string" ? e.data : "");
        if (!frame) return;
        switch(frame.type){
            case "event":
                this.handleEvent(frame);
                break;
            case "res":
                this.handleResponse(frame);
                break;
        }
    }
    handleEvent(frame) {
        if (frame.event === "connect.challenge") {
            // Respond with Protocol v3 connect handshake
            const authFrame = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$protocol$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["makeReq"])("connect", {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                    id: "openclaw-control-ui",
                    version: "1.0.0",
                    platform: "web",
                    mode: "ui"
                },
                role: "operator",
                scopes: [
                    "operator.read",
                    "operator.write",
                    "operator.admin"
                ],
                auth: {
                    token: this.token
                }
            });
            this.send(authFrame);
            return;
        }
        // Forward all other events
        console.log("[AWF] Event:", frame.event, JSON.stringify(frame.payload).slice(0, 200));
        this.eventHandlers.forEach((h)=>h(frame));
    }
    handleResponse(frame) {
        // Check if this is the connect response (hello-ok)
        const payload = frame.payload;
        if (frame.ok && payload?.type === "hello-ok") {
            const snapshot = payload.snapshot;
            const sessionDefaults = snapshot?.sessionDefaults;
            this.mainSessionKey = sessionDefaults?.mainSessionKey || "";
            console.log("[AWF] hello-ok: mainSessionKey=", this.mainSessionKey, "auth=", JSON.stringify(payload.auth));
            this.reconnectAttempt = 0;
            this.setState("connected");
        }
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        if (frame.ok) {
            pending.resolve(frame.payload);
        } else {
            const errObj = frame.error;
            const errMsg = errObj?.message || JSON.stringify(frame.error || "Request failed");
            console.error("[AWF] Request failed:", errMsg, frame.error);
            pending.reject(new Error(errMsg));
        }
    }
    handleClose() {
        this.ws = null;
        this.rejectAll("Connection closed");
        this.setState("disconnected");
        if (!this.intentionalClose) {
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        this.clearReconnect();
        const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
        this.reconnectAttempt++;
        this.reconnectTimer = setTimeout(()=>this.connect(), delay);
    }
    clearReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    rejectAll(reason) {
        this.pending.forEach((p)=>{
            clearTimeout(p.timer);
            p.reject(new Error(reason));
        });
        this.pending.clear();
    }
}
}),
"[project]/src/lib/gateway/hooks.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GatewayProvider",
    ()=>GatewayProvider,
    "useAgents",
    ()=>useAgents,
    "useChat",
    ()=>useChat,
    "useGateway",
    ()=>useGateway,
    "useSessions",
    ()=>useSessions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@15.5.12_@babel+core@7.29.0_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@15.5.12_@babel+core@7.29.0_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$client$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/gateway/client.ts [app-ssr] (ecmascript)");
"use client";
;
;
;
const GatewayContext = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["createContext"])({
    client: null,
    state: "disconnected"
});
function GatewayProvider({ children }) {
    const [client, setClient] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    const [state, setState] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("disconnected");
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const url = ("TURBOPACK compile-time value", "ws://100.114.145.125:18789") || "ws://127.0.0.1:18789";
        const token = ("TURBOPACK compile-time value", "298e503e4ac3a1f0e8db82fa02c36c92e7c75bbd8b8eb8d3") || "";
        console.log("[AWF] Connecting to gateway:", url, "token:", ("TURBOPACK compile-time truthy", 1) ? "✓" : "TURBOPACK unreachable");
        const c = new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$client$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["GatewayClient"](url, token);
        setClient(c);
        const unsub = c.onStateChange((s)=>{
            console.log("[AWF] Gateway state:", s);
            setState(s);
        });
        c.connect();
        return ()=>{
            unsub();
            c.disconnect();
        };
    }, []);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(GatewayContext.Provider, {
        value: {
            client,
            state
        },
        children: children
    }, void 0, false, {
        fileName: "[project]/src/lib/gateway/hooks.tsx",
        lineNumber: 59,
        columnNumber: 5
    }, this);
}
function useGateway() {
    const ctx = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useContext"])(GatewayContext);
    return {
        ...ctx,
        mainSessionKey: ctx.client?.mainSessionKey || ""
    };
}
function useAgents() {
    const { client, state } = useGateway();
    const [agents, setAgents] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])([]);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const fetchAgents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async ()=>{
        if (!client || state !== "connected") return;
        setLoading(true);
        try {
            const res = await client.request("agents.list");
            setAgents(res?.agents || []);
        } catch  {
        // silently fail
        } finally{
            setLoading(false);
        }
    }, [
        client,
        state
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        fetchAgents();
    }, [
        fetchAgents
    ]);
    return {
        agents,
        loading,
        refresh: fetchAgents
    };
}
function useSessions() {
    const { client, state } = useGateway();
    const [sessions, setSessions] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])([]);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const lastRefreshAtRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(0);
    const fetchSessions = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async ()=>{
        if (!client || state !== "connected") return;
        setLoading(true);
        try {
            const res = await client.request("sessions.list", {
                limit: 200
            });
            // Map gateway sessions to our Session type, preserving extra fields
            const mapped = (res?.sessions || []).map((s)=>({
                    key: String(s.key || ""),
                    agentId: undefined,
                    agentName: undefined,
                    title: s.label ? String(s.label) : undefined,
                    lastMessage: undefined,
                    updatedAt: typeof s.updatedAt === "number" ? new Date(s.updatedAt).toISOString() : undefined,
                    messageCount: undefined,
                    // Extra fields for session-switcher
                    ...s
                }));
            setSessions(mapped);
            lastRefreshAtRef.current = Date.now();
        } catch  {
        // silently fail
        } finally{
            setLoading(false);
        }
    }, [
        client,
        state
    ]);
    const refreshThrottled = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        const now = Date.now();
        // Prevent burst refreshes when many agent events arrive
        if (now - lastRefreshAtRef.current < 1200) return;
        fetchSessions();
    }, [
        fetchSessions
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        fetchSessions();
    }, [
        fetchSessions
    ]);
    // Realtime-ish updates: refresh sessions when agent turn finishes
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!client) return;
        const unsub = client.onEvent((frame)=>{
            if (frame.event !== "agent") return;
            const raw = frame.payload;
            const stream = raw.stream;
            const data = raw.data;
            if (stream === "lifecycle" && (data?.phase === "end" || data?.phase === "start")) {
                refreshThrottled();
            }
        });
        return unsub;
    }, [
        client,
        refreshThrottled
    ]);
    // Periodic safety refresh so header metadata does not go stale
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (state !== "connected") return;
        const id = setInterval(()=>{
            refreshThrottled();
        }, 15000);
        return ()=>clearInterval(id);
    }, [
        state,
        refreshThrottled
    ]);
    return {
        sessions,
        loading,
        refresh: fetchSessions
    };
}
// --- Helpers ---
/** Strip OpenClaw inbound metadata from user messages */ function stripInboundMeta(text) {
    // Remove "Conversation info (untrusted metadata):\n```json\n{...}\n```\n" blocks
    let cleaned = text.replace(/Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g, "");
    // Remove "[Thu 2026-02-19 21:46 GMT+9] " style timestamps at start
    cleaned = cleaned.replace(/^\[[\w\s\-:+]+\]\s*/g, "");
    return cleaned.trim();
}
function useChat(sessionKey) {
    const { client, state } = useGateway();
    const [messages, setMessages] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])([]);
    const [streaming, setStreaming] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const streamBuf = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const sessionKeyRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(sessionKey);
    // Queue storage key (must be before loadHistory which references it)
    const queueStorageKey = sessionKey ? `awf:queue:${sessionKey}` : null;
    // Reset state on session change
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (sessionKeyRef.current !== sessionKey) {
            sessionKeyRef.current = sessionKey;
            setMessages([]);
            setStreaming(false);
            streamBuf.current = null;
        }
    }, [
        sessionKey
    ]);
    // Load history
    const loadHistory = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async ()=>{
        if (!client || state !== "connected") return;
        setLoading(true);
        try {
            const res = await client.request("chat.history", {
                sessionKey,
                limit: 100
            });
            const histMsgs = (res?.messages || []).filter((m)=>m.role === "user" || m.role === "assistant" || m.role === "system").map((m, i)=>{
                // Extract text and images from content
                let textContent = '';
                const imgAttachments = [];
                if (typeof m.content === 'string') {
                    textContent = m.content;
                } else if (Array.isArray(m.content)) {
                    const parts = m.content;
                    const hasToolUse = parts.some((p)=>p.type === 'tool_use');
                    for (const p of parts){
                        if (p.type === 'text' && typeof p.text === 'string') {
                            // Skip short narration between tool calls (e.g. "패널 루트에 ref:")
                            if (hasToolUse && m.role === 'assistant') {
                                const text = p.text.trim();
                                // Keep substantial text blocks (>100 chars or multi-line with content)
                                if (text.length < 100 && !text.includes('\n')) continue;
                            }
                            textContent += p.text;
                        } else if (p.type === 'image_url' || p.type === 'image') {
                            const url = typeof p.image_url === 'object' && p.image_url ? p.image_url.url : typeof p.url === 'string' ? p.url : typeof p.source === 'object' && p.source ? `data:${p.source.media_type};base64,${p.source.data}` : undefined;
                            if (url) {
                                imgAttachments.push({
                                    fileName: 'image',
                                    mimeType: 'image/png',
                                    dataUrl: url
                                });
                            }
                        }
                    }
                } else {
                    textContent = String(m.content || '');
                }
                if (m.role === 'user') textContent = stripInboundMeta(textContent);
                return {
                    id: `hist-${i}`,
                    role: m.role === 'system' || m.role === 'user' && /\[System Message\]|\[sessionId:|^System:\s*\[/.test(textContent) ? 'system' : m.role,
                    content: textContent,
                    timestamp: m.timestamp || new Date().toISOString(),
                    toolCalls: m.toolCalls || [],
                    attachments: imgAttachments.length > 0 ? imgAttachments : undefined
                };
            });
            // Restore queued messages from localStorage
            const savedQueue = queueStorageKey ? localStorage.getItem(queueStorageKey) : null;
            if (savedQueue) {
                try {
                    const queue = JSON.parse(savedQueue);
                    queueRef.current = queue;
                    const queuedMsgs = queue.map((q)=>({
                            id: q.id,
                            role: "user",
                            content: q.text,
                            timestamp: new Date().toISOString(),
                            toolCalls: [],
                            queued: true
                        }));
                    setMessages([
                        ...histMsgs,
                        ...queuedMsgs
                    ]);
                } catch  {
                    setMessages(histMsgs);
                }
            } else {
                setMessages(histMsgs);
            }
        } catch  {
        // silently fail
        } finally{
            setLoading(false);
        }
    }, [
        client,
        state,
        sessionKey,
        queueStorageKey
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        loadHistory();
    }, [
        loadHistory
    ]);
    // Handle agent events
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!client) return;
        // Deduplicate events by frame.seq to prevent double-rendering
        let lastSeq = -1;
        const unsub = client.onEvent((frame)=>{
            if (frame.event !== "agent") return;
            // Deduplicate: gateway sometimes sends the same event twice
            // Use frame-level seq (not payload.seq)
            if (frame.seq != null) {
                if (frame.seq <= lastSeq) return;
                lastSeq = frame.seq;
            }
            const raw = frame.payload;
            // Real Gateway payload: {runId, stream, data:{text,delta}, sessionKey}
            const stream = raw.stream;
            const data = raw.data;
            const evSessionKey = raw.sessionKey;
            // Filter events: only process events matching current session
            if (evSessionKey && evSessionKey !== sessionKeyRef.current) return;
            if (!evSessionKey && sessionKeyRef.current) return;
            // Map real gateway events to our handler
            if (stream === "assistant" && (typeof data?.delta === "string" || typeof data?.text === "string")) {
                // Streamed delta or one-shot text
                const chunk = data?.delta ?? data?.text;
                setStreaming(true);
                if (!streamBuf.current) {
                    const id = `stream-${Date.now()}`;
                    streamBuf.current = {
                        id,
                        content: "",
                        toolCalls: new Map()
                    };
                }
                streamBuf.current.content += chunk;
                const snap = streamBuf.current;
                setMessages((prev)=>{
                    const existing = prev.findIndex((m)=>m.id === snap.id);
                    const msg = {
                        id: snap.id,
                        role: "assistant",
                        content: snap.content,
                        timestamp: new Date().toISOString(),
                        toolCalls: Array.from(snap.toolCalls.values()),
                        streaming: true
                    };
                    if (existing >= 0) {
                        const next = [
                            ...prev
                        ];
                        next[existing] = msg;
                        return next;
                    }
                    return [
                        ...prev,
                        msg
                    ];
                });
            } else if (stream === "tool-start" && data) {
                // tool-call-start
                const callId = data.toolCallId || data.callId || "";
                const name = data.name || data.tool || "";
                const args = data.args;
                if (!streamBuf.current) {
                    const id = `stream-${Date.now()}`;
                    streamBuf.current = {
                        id,
                        content: "",
                        toolCalls: new Map()
                    };
                }
                streamBuf.current.toolCalls.set(callId, {
                    callId,
                    name,
                    args,
                    status: "running"
                });
                const snapTool = streamBuf.current;
                setMessages((prev)=>{
                    const existing = prev.findIndex((m)=>m.id === snapTool.id);
                    const msg = {
                        id: snapTool.id,
                        role: "assistant",
                        content: snapTool.content,
                        timestamp: new Date().toISOString(),
                        toolCalls: Array.from(snapTool.toolCalls.values()),
                        streaming: true
                    };
                    if (existing >= 0) {
                        const next = [
                            ...prev
                        ];
                        next[existing] = msg;
                        return next;
                    }
                    return [
                        ...prev,
                        msg
                    ];
                });
            } else if (stream === "tool-end" && data) {
                // tool-call-end
                const callId = data.toolCallId || data.callId || "";
                const result = data.result;
                if (streamBuf.current) {
                    const tc = streamBuf.current.toolCalls.get(callId);
                    if (tc) {
                        tc.status = "done";
                        tc.result = result;
                    }
                    const snapEnd = streamBuf.current;
                    setMessages((prev)=>{
                        const existing = prev.findIndex((m)=>m.id === snapEnd.id);
                        if (existing >= 0) {
                            const next = [
                                ...prev
                            ];
                            next[existing] = {
                                ...next[existing],
                                toolCalls: Array.from(snapEnd.toolCalls.values())
                            };
                            return next;
                        }
                        return prev;
                    });
                }
            } else if (stream === "lifecycle" && data?.phase === "end") {
                // lifecycle end = done
                setStreaming(false);
                if (streamBuf.current) {
                    const finalId = streamBuf.current.id;
                    const finalContent = streamBuf.current.content;
                    const finalTools = Array.from(streamBuf.current.toolCalls.values());
                    setMessages((prev)=>prev.map((m)=>m.id === finalId ? {
                                ...m,
                                content: finalContent,
                                toolCalls: finalTools,
                                streaming: false
                            } : m));
                    streamBuf.current = null;
                }
            } else if (stream === "done" || stream === "end" || stream === "finish") {
                // done
                setStreaming(false);
                if (streamBuf.current) {
                    const finalId = streamBuf.current.id;
                    const finalContent = data?.text || streamBuf.current.content;
                    const finalTools = Array.from(streamBuf.current.toolCalls.values());
                    setMessages((prev)=>prev.map((m)=>m.id === finalId ? {
                                ...m,
                                content: finalContent,
                                toolCalls: finalTools,
                                streaming: false
                            } : m));
                    streamBuf.current = null;
                }
            } else if (stream === "error") {
                // error
                setStreaming(false);
                const errMsg = data?.message || data?.error || "Unknown error";
                if (streamBuf.current) {
                    const errId = streamBuf.current.id;
                    setMessages((prev)=>prev.map((m)=>m.id === errId ? {
                                ...m,
                                content: m.content + `\n\n**Error:** ${errMsg}`,
                                streaming: false
                            } : m));
                    streamBuf.current = null;
                }
            }
        });
        return unsub;
    }, [
        client,
        sessionKey
    ]);
    // Message queue for messages sent while streaming — persist to localStorage
    const queueRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])((()=>{
        if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
        ;
        return [];
    })());
    const processingQueue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(false);
    const persistQueue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        if (!queueStorageKey) return;
        if (queueRef.current.length > 0) {
            localStorage.setItem(queueStorageKey, JSON.stringify(queueRef.current));
        } else {
            localStorage.removeItem(queueStorageKey);
        }
    }, [
        queueStorageKey
    ]);
    // Actually send a message to the gateway
    const doSend = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async (text, msgId)=>{
        if (!client || state !== "connected") return;
        // Mark message as no longer queued
        setMessages((prev)=>prev.map((m)=>m.id === msgId ? {
                    ...m,
                    queued: false
                } : m));
        setStreaming(true);
        try {
            await client.request("chat.send", {
                message: text,
                idempotencyKey: `awf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                sessionKey
            });
        } catch (err) {
            console.error("[AWF] chat.send error:", String(err));
            setStreaming(false);
        }
    }, [
        client,
        state,
        sessionKey
    ]);
    // Process queue: send next message when streaming ends
    const processQueue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async ()=>{
        if (processingQueue.current) return;
        processingQueue.current = true;
        while(queueRef.current.length > 0){
            const next = queueRef.current.shift();
            persistQueue();
            // Check if message was cancelled (removed from messages)
            const stillExists = await new Promise((resolve)=>{
                setMessages((prev)=>{
                    resolve(prev.some((m)=>m.id === next.id));
                    return prev;
                });
            });
            if (stillExists) {
                await doSend(next.text, next.id);
                // Wait for streaming to finish before sending next
                await new Promise((resolve)=>{
                    const check = ()=>{
                        // Poll streaming state - resolve when not streaming
                        setTimeout(()=>{
                            setStreaming((s)=>{
                                if (!s) resolve();
                                else check();
                                return s;
                            });
                        }, 200);
                    };
                    check();
                });
            }
        }
        processingQueue.current = false;
    }, [
        doSend
    ]);
    // Send message (queues if currently streaming)
    const sendMessage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((text)=>{
        if (!client || state !== "connected" || !text.trim()) return;
        const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const userMsg = {
            id: msgId,
            role: "user",
            content: text,
            timestamp: new Date().toISOString(),
            toolCalls: [],
            queued: streaming
        };
        setMessages((prev)=>[
                ...prev,
                userMsg
            ]);
        if (streaming) {
            // Queue for later
            queueRef.current.push({
                id: msgId,
                text
            });
            persistQueue();
        } else {
            // Send immediately
            doSend(text, msgId);
        }
    }, [
        client,
        state,
        streaming,
        doSend
    ]);
    // When streaming ends, process queue
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!streaming && queueRef.current.length > 0) {
            processQueue();
        }
    }, [
        streaming,
        processQueue
    ]);
    // Cancel a queued message
    const cancelQueued = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((msgId)=>{
        queueRef.current = queueRef.current.filter((q)=>q.id !== msgId);
        persistQueue();
        setMessages((prev)=>prev.filter((m)=>m.id !== msgId));
    }, [
        persistQueue
    ]);
    // Abort
    const abort = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async ()=>{
        if (!client || state !== "connected") return;
        try {
            await client.request("chat.abort", {
                sessionKey
            });
        } catch  {
        // silently fail
        }
        setStreaming(false);
    }, [
        client,
        state,
        sessionKey
    ]);
    // Add a user message to the display (for external callers like attachment sends)
    const addUserMessage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((text, attachments)=>{
        const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const userMsg = {
            id: msgId,
            role: "user",
            content: text,
            timestamp: new Date().toISOString(),
            toolCalls: [],
            queued: streaming,
            attachments
        };
        setMessages((prev)=>[
                ...prev,
                userMsg
            ]);
        if (!streaming) {
            setStreaming(true);
        }
    }, [
        streaming
    ]);
    return {
        messages,
        streaming,
        loading,
        sendMessage,
        addUserMessage,
        cancelQueued,
        abort,
        reload: loadHistory
    };
}
}),
"[project]/src/lib/utils.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "cn",
    ()=>cn
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$clsx$40$2$2e$1$2e$1$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$tailwind$2d$merge$40$3$2e$5$2e$0$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/tailwind-merge@3.5.0/node_modules/tailwind-merge/dist/bundle-mjs.mjs [app-ssr] (ecmascript)");
;
;
function cn(...inputs) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$tailwind$2d$merge$40$3$2e$5$2e$0$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["twMerge"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$clsx$40$2$2e$1$2e$1$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["clsx"])(inputs));
}
}),
"[project]/src/components/ui/tooltip.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Tooltip",
    ()=>Tooltip,
    "TooltipContent",
    ()=>TooltipContent,
    "TooltipProvider",
    ()=>TooltipProvider,
    "TooltipTrigger",
    ()=>TooltipTrigger
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@15.5.12_@babel+core@7.29.0_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/@radix-ui+react-tooltip@1.2.8_@types+react-dom@19.2.3_@types+react@19.2.14__@types+reac_9074d9fb06315b089b2bee17c4c65951/node_modules/@radix-ui/react-tooltip/dist/index.mjs [app-ssr] (ecmascript) <export * as Tooltip>");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/utils.ts [app-ssr] (ecmascript)");
"use client";
;
;
;
function TooltipProvider({ delayDuration = 0, ...props }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Provider, {
        "data-slot": "tooltip-provider",
        delayDuration: delayDuration,
        ...props
    }, void 0, false, {
        fileName: "[project]/src/components/ui/tooltip.tsx",
        lineNumber: 13,
        columnNumber: 5
    }, this);
}
function Tooltip({ ...props }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Root, {
        "data-slot": "tooltip",
        ...props
    }, void 0, false, {
        fileName: "[project]/src/components/ui/tooltip.tsx",
        lineNumber: 24,
        columnNumber: 10
    }, this);
}
function TooltipTrigger({ ...props }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Trigger, {
        "data-slot": "tooltip-trigger",
        ...props
    }, void 0, false, {
        fileName: "[project]/src/components/ui/tooltip.tsx",
        lineNumber: 30,
        columnNumber: 10
    }, this);
}
function TooltipContent({ className, sideOffset = 0, children, ...props }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Portal, {
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Content, {
            "data-slot": "tooltip-content",
            sideOffset: sideOffset,
            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])("bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance", className),
            ...props,
            children: [
                children,
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Arrow, {
                    className: "bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]"
                }, void 0, false, {
                    fileName: "[project]/src/components/ui/tooltip.tsx",
                    lineNumber: 51,
                    columnNumber: 9
                }, this)
            ]
        }, void 0, true, {
            fileName: "[project]/src/components/ui/tooltip.tsx",
            lineNumber: 41,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/src/components/ui/tooltip.tsx",
        lineNumber: 40,
        columnNumber: 5
    }, this);
}
;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/dynamic-access-async-storage.external.js [external] (next/dist/server/app-render/dynamic-access-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/dynamic-access-async-storage.external.js", () => require("next/dist/server/app-render/dynamic-access-async-storage.external.js"));

module.exports = mod;
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__38d5355a._.js.map