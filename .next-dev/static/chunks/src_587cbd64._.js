(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/lib/gateway/protocol.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "makeReq",
    ()=>makeReq,
    "parseFrame",
    ()=>parseFrame
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$uuid$40$13$2e$0$2e$0$2f$node_modules$2f$uuid$2f$dist$2f$v4$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__v4$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/uuid@13.0.0/node_modules/uuid/dist/v4.js [app-client] (ecmascript) <export default as v4>");
;
function makeReq(method, params) {
    return {
        type: "req",
        id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$uuid$40$13$2e$0$2e$0$2f$node_modules$2f$uuid$2f$dist$2f$v4$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__v4$3e$__["v4"])(),
        method,
        params
    };
}
function parseFrame(data) {
    try {
        return JSON.parse(data);
    } catch (e) {
        return null;
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/lib/gateway/client.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GatewayClient",
    ()=>GatewayClient
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/@swc+helpers@0.5.15/node_modules/@swc/helpers/esm/_define_property.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$protocol$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/gateway/protocol.ts [app-client] (ecmascript)");
;
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
        } catch (e) {
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
            throw new Error("Not connected (state: ".concat(this.state, ")"));
        }
        const frame = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$protocol$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["makeReq"])(method, params);
        return new Promise((resolve, reject)=>{
            const timer = setTimeout(()=>{
                this.pending.delete(frame.id);
                reject(new Error("Request timeout: ".concat(method)));
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
        var _this_ws;
        if (((_this_ws = this.ws) === null || _this_ws === void 0 ? void 0 : _this_ws.readyState) === WebSocket.OPEN) {
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
        const frame = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$protocol$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseFrame"])(typeof e.data === "string" ? e.data : "");
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
            const authFrame = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$protocol$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["makeReq"])("connect", {
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
        if (frame.ok && (payload === null || payload === void 0 ? void 0 : payload.type) === "hello-ok") {
            const snapshot = payload.snapshot;
            const sessionDefaults = snapshot === null || snapshot === void 0 ? void 0 : snapshot.sessionDefaults;
            this.mainSessionKey = (sessionDefaults === null || sessionDefaults === void 0 ? void 0 : sessionDefaults.mainSessionKey) || "";
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
            const errMsg = (errObj === null || errObj === void 0 ? void 0 : errObj.message) || JSON.stringify(frame.error || "Request failed");
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
    constructor(url, token){
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "ws", null);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "url", void 0);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "token", void 0);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "state", "disconnected");
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "pending", new Map());
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "eventHandlers", new Set());
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "stateHandlers", new Set());
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "reconnectAttempt", 0);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "reconnectTimer", null);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "intentionalClose", false);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$swc$2b$helpers$40$0$2e$5$2e$15$2f$node_modules$2f40$swc$2f$helpers$2f$esm$2f$_define_property$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["_"])(this, "mainSessionKey", "");
        this.url = url;
        this.token = token;
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/lib/gateway/hooks.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
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
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/node_modules/.pnpm/next@15.5.12_@babel+core@7.29.0_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@15.5.12_@babel+core@7.29.0_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@15.5.12_@babel+core@7.29.0_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$client$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/gateway/client.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature(), _s2 = __turbopack_context__.k.signature(), _s3 = __turbopack_context__.k.signature(), _s4 = __turbopack_context__.k.signature();
"use client";
;
;
const GatewayContext = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createContext"])({
    client: null,
    state: "disconnected"
});
function GatewayProvider(param) {
    let { children } = param;
    _s();
    const [client, setClient] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [state, setState] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("disconnected");
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "GatewayProvider.useEffect": ()=>{
            const url = ("TURBOPACK compile-time value", "ws://100.114.145.125:18789") || "ws://127.0.0.1:18789";
            const token = ("TURBOPACK compile-time value", "298e503e4ac3a1f0e8db82fa02c36c92e7c75bbd8b8eb8d3") || "";
            console.log("[AWF] Connecting to gateway:", url, "token:", ("TURBOPACK compile-time truthy", 1) ? "✓" : "TURBOPACK unreachable");
            const c = new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gateway$2f$client$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["GatewayClient"](url, token);
            setClient(c);
            const unsub = c.onStateChange({
                "GatewayProvider.useEffect.unsub": (s)=>{
                    console.log("[AWF] Gateway state:", s);
                    setState(s);
                }
            }["GatewayProvider.useEffect.unsub"]);
            c.connect();
            return ({
                "GatewayProvider.useEffect": ()=>{
                    unsub();
                    c.disconnect();
                }
            })["GatewayProvider.useEffect"];
        }
    }["GatewayProvider.useEffect"], []);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(GatewayContext.Provider, {
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
_s(GatewayProvider, "8ZDBc6avBUkAyM5NFCw/qnCZudw=");
_c = GatewayProvider;
function useGateway() {
    var _ctx_client;
    _s1();
    const ctx = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useContext"])(GatewayContext);
    return {
        ...ctx,
        mainSessionKey: ((_ctx_client = ctx.client) === null || _ctx_client === void 0 ? void 0 : _ctx_client.mainSessionKey) || ""
    };
}
_s1(useGateway, "/dMy7t63NXD4eYACoT93CePwGrg=");
function useAgents() {
    _s2();
    const { client, state } = useGateway();
    const [agents, setAgents] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const fetchAgents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useAgents.useCallback[fetchAgents]": async ()=>{
            if (!client || state !== "connected") return;
            setLoading(true);
            try {
                const res = await client.request("agents.list");
                setAgents((res === null || res === void 0 ? void 0 : res.agents) || []);
            } catch (e) {
            // silently fail
            } finally{
                setLoading(false);
            }
        }
    }["useAgents.useCallback[fetchAgents]"], [
        client,
        state
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useAgents.useEffect": ()=>{
            fetchAgents();
        }
    }["useAgents.useEffect"], [
        fetchAgents
    ]);
    return {
        agents,
        loading,
        refresh: fetchAgents
    };
}
_s2(useAgents, "R9Ab+Dz+JOdPOYtveXI7VMiDj2g=", false, function() {
    return [
        useGateway
    ];
});
function useSessions() {
    _s3();
    const { client, state } = useGateway();
    const [sessions, setSessions] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const lastRefreshAtRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    const fetchSessions = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useSessions.useCallback[fetchSessions]": async ()=>{
            if (!client || state !== "connected") return;
            setLoading(true);
            try {
                const res = await client.request("sessions.list", {
                    limit: 200
                });
                // Map gateway sessions to our Session type, preserving extra fields
                const mapped = ((res === null || res === void 0 ? void 0 : res.sessions) || []).map({
                    "useSessions.useCallback[fetchSessions].mapped": (s)=>({
                            key: String(s.key || ""),
                            agentId: undefined,
                            agentName: undefined,
                            title: s.label ? String(s.label) : undefined,
                            lastMessage: undefined,
                            updatedAt: typeof s.updatedAt === "number" ? new Date(s.updatedAt).toISOString() : undefined,
                            messageCount: undefined,
                            // Extra fields for session-switcher
                            ...s
                        })
                }["useSessions.useCallback[fetchSessions].mapped"]);
                setSessions(mapped);
                lastRefreshAtRef.current = Date.now();
            } catch (e) {
            // silently fail
            } finally{
                setLoading(false);
            }
        }
    }["useSessions.useCallback[fetchSessions]"], [
        client,
        state
    ]);
    const refreshThrottled = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useSessions.useCallback[refreshThrottled]": ()=>{
            const now = Date.now();
            // Prevent burst refreshes when many agent events arrive
            if (now - lastRefreshAtRef.current < 1200) return;
            fetchSessions();
        }
    }["useSessions.useCallback[refreshThrottled]"], [
        fetchSessions
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useSessions.useEffect": ()=>{
            fetchSessions();
        }
    }["useSessions.useEffect"], [
        fetchSessions
    ]);
    // Realtime-ish updates: refresh sessions when agent turn finishes
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useSessions.useEffect": ()=>{
            if (!client) return;
            const unsub = client.onEvent({
                "useSessions.useEffect.unsub": (frame)=>{
                    if (frame.event !== "agent") return;
                    const raw = frame.payload;
                    const stream = raw.stream;
                    const data = raw.data;
                    if (stream === "lifecycle" && ((data === null || data === void 0 ? void 0 : data.phase) === "end" || (data === null || data === void 0 ? void 0 : data.phase) === "start")) {
                        refreshThrottled();
                    }
                }
            }["useSessions.useEffect.unsub"]);
            return unsub;
        }
    }["useSessions.useEffect"], [
        client,
        refreshThrottled
    ]);
    // Periodic safety refresh so header metadata does not go stale
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useSessions.useEffect": ()=>{
            if (state !== "connected") return;
            const id = setInterval({
                "useSessions.useEffect.id": ()=>{
                    refreshThrottled();
                }
            }["useSessions.useEffect.id"], 15000);
            return ({
                "useSessions.useEffect": ()=>clearInterval(id)
            })["useSessions.useEffect"];
        }
    }["useSessions.useEffect"], [
        state,
        refreshThrottled
    ]);
    return {
        sessions,
        loading,
        refresh: fetchSessions
    };
}
_s3(useSessions, "C0eDgXRxzHmN2PmmVC7KpVjdUoI=", false, function() {
    return [
        useGateway
    ];
});
// --- Helpers ---
/** Strip OpenClaw inbound metadata from user messages */ function stripInboundMeta(text) {
    // Remove "Conversation info (untrusted metadata):\n```json\n{...}\n```\n" blocks
    let cleaned = text.replace(/Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g, "");
    // Remove "[Thu 2026-02-19 21:46 GMT+9] " style timestamps at start
    cleaned = cleaned.replace(/^\[[\w\s\-:+]+\]\s*/g, "");
    return cleaned.trim();
}
function useChat(sessionKey) {
    _s4();
    const { client, state } = useGateway();
    const [messages, setMessages] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [streaming, setStreaming] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const streamBuf = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const sessionKeyRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(sessionKey);
    // Queue storage key (must be before loadHistory which references it)
    const queueStorageKey = sessionKey ? "awf:queue:".concat(sessionKey) : null;
    // Reset state on session change
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useChat.useEffect": ()=>{
            if (sessionKeyRef.current !== sessionKey) {
                sessionKeyRef.current = sessionKey;
                setMessages([]);
                setStreaming(false);
                streamBuf.current = null;
            }
        }
    }["useChat.useEffect"], [
        sessionKey
    ]);
    // Load history
    const loadHistory = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useChat.useCallback[loadHistory]": async ()=>{
            if (!client || state !== "connected") return;
            setLoading(true);
            try {
                const res = await client.request("chat.history", {
                    sessionKey,
                    limit: 100
                });
                const histMsgs = ((res === null || res === void 0 ? void 0 : res.messages) || []).filter({
                    "useChat.useCallback[loadHistory].histMsgs": (m)=>m.role === "user" || m.role === "assistant" || m.role === "system"
                }["useChat.useCallback[loadHistory].histMsgs"]).map({
                    "useChat.useCallback[loadHistory].histMsgs": (m, i)=>{
                        // Extract text and images from content
                        let textContent = '';
                        const imgAttachments = [];
                        if (typeof m.content === 'string') {
                            textContent = m.content;
                        } else if (Array.isArray(m.content)) {
                            const parts = m.content;
                            const hasToolUse = parts.some({
                                "useChat.useCallback[loadHistory].histMsgs.hasToolUse": (p)=>p.type === 'tool_use'
                            }["useChat.useCallback[loadHistory].histMsgs.hasToolUse"]);
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
                                    const url = typeof p.image_url === 'object' && p.image_url ? p.image_url.url : typeof p.url === 'string' ? p.url : typeof p.source === 'object' && p.source ? "data:".concat(p.source.media_type, ";base64,").concat(p.source.data) : undefined;
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
                            id: "hist-".concat(i),
                            role: m.role === 'system' || m.role === 'user' && /\[System Message\]|\[sessionId:|^System:\s*\[/.test(textContent) ? 'system' : m.role,
                            content: textContent,
                            timestamp: m.timestamp || new Date().toISOString(),
                            toolCalls: m.toolCalls || [],
                            attachments: imgAttachments.length > 0 ? imgAttachments : undefined
                        };
                    }
                }["useChat.useCallback[loadHistory].histMsgs"]);
                // Restore queued messages from localStorage
                const savedQueue = queueStorageKey ? localStorage.getItem(queueStorageKey) : null;
                if (savedQueue) {
                    try {
                        const queue = JSON.parse(savedQueue);
                        queueRef.current = queue;
                        const queuedMsgs = queue.map({
                            "useChat.useCallback[loadHistory].queuedMsgs": (q)=>({
                                    id: q.id,
                                    role: "user",
                                    content: q.text,
                                    timestamp: new Date().toISOString(),
                                    toolCalls: [],
                                    queued: true
                                })
                        }["useChat.useCallback[loadHistory].queuedMsgs"]);
                        setMessages([
                            ...histMsgs,
                            ...queuedMsgs
                        ]);
                    } catch (e) {
                        setMessages(histMsgs);
                    }
                } else {
                    setMessages(histMsgs);
                }
            } catch (e) {
            // silently fail
            } finally{
                setLoading(false);
            }
        }
    }["useChat.useCallback[loadHistory]"], [
        client,
        state,
        sessionKey,
        queueStorageKey
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useChat.useEffect": ()=>{
            loadHistory();
        }
    }["useChat.useEffect"], [
        loadHistory
    ]);
    // Handle agent events
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useChat.useEffect": ()=>{
            if (!client) return;
            // Deduplicate events by frame.seq to prevent double-rendering
            let lastSeq = -1;
            const unsub = client.onEvent({
                "useChat.useEffect.unsub": (frame)=>{
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
                    if (stream === "assistant" && (typeof (data === null || data === void 0 ? void 0 : data.delta) === "string" || typeof (data === null || data === void 0 ? void 0 : data.text) === "string")) {
                        var _ref;
                        // Streamed delta or one-shot text
                        const chunk = (_ref = data === null || data === void 0 ? void 0 : data.delta) !== null && _ref !== void 0 ? _ref : data === null || data === void 0 ? void 0 : data.text;
                        setStreaming(true);
                        if (!streamBuf.current) {
                            const id = "stream-".concat(Date.now());
                            streamBuf.current = {
                                id,
                                content: "",
                                toolCalls: new Map()
                            };
                        }
                        streamBuf.current.content += chunk;
                        const snap = streamBuf.current;
                        setMessages({
                            "useChat.useEffect.unsub": (prev)=>{
                                const existing = prev.findIndex({
                                    "useChat.useEffect.unsub.existing": (m)=>m.id === snap.id
                                }["useChat.useEffect.unsub.existing"]);
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
                            }
                        }["useChat.useEffect.unsub"]);
                    } else if (stream === "tool-start" && data) {
                        // tool-call-start
                        const callId = data.toolCallId || data.callId || "";
                        const name = data.name || data.tool || "";
                        const args = data.args;
                        if (!streamBuf.current) {
                            const id = "stream-".concat(Date.now());
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
                        setMessages({
                            "useChat.useEffect.unsub": (prev)=>{
                                const existing = prev.findIndex({
                                    "useChat.useEffect.unsub.existing": (m)=>m.id === snapTool.id
                                }["useChat.useEffect.unsub.existing"]);
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
                            }
                        }["useChat.useEffect.unsub"]);
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
                            setMessages({
                                "useChat.useEffect.unsub": (prev)=>{
                                    const existing = prev.findIndex({
                                        "useChat.useEffect.unsub.existing": (m)=>m.id === snapEnd.id
                                    }["useChat.useEffect.unsub.existing"]);
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
                                }
                            }["useChat.useEffect.unsub"]);
                        }
                    } else if (stream === "lifecycle" && (data === null || data === void 0 ? void 0 : data.phase) === "end") {
                        // lifecycle end = done
                        setStreaming(false);
                        if (streamBuf.current) {
                            const finalId = streamBuf.current.id;
                            const finalContent = streamBuf.current.content;
                            const finalTools = Array.from(streamBuf.current.toolCalls.values());
                            setMessages({
                                "useChat.useEffect.unsub": (prev)=>prev.map({
                                        "useChat.useEffect.unsub": (m)=>m.id === finalId ? {
                                                ...m,
                                                content: finalContent,
                                                toolCalls: finalTools,
                                                streaming: false
                                            } : m
                                    }["useChat.useEffect.unsub"])
                            }["useChat.useEffect.unsub"]);
                            streamBuf.current = null;
                        }
                    } else if (stream === "done" || stream === "end" || stream === "finish") {
                        // done
                        setStreaming(false);
                        if (streamBuf.current) {
                            const finalId = streamBuf.current.id;
                            const finalContent = (data === null || data === void 0 ? void 0 : data.text) || streamBuf.current.content;
                            const finalTools = Array.from(streamBuf.current.toolCalls.values());
                            setMessages({
                                "useChat.useEffect.unsub": (prev)=>prev.map({
                                        "useChat.useEffect.unsub": (m)=>m.id === finalId ? {
                                                ...m,
                                                content: finalContent,
                                                toolCalls: finalTools,
                                                streaming: false
                                            } : m
                                    }["useChat.useEffect.unsub"])
                            }["useChat.useEffect.unsub"]);
                            streamBuf.current = null;
                        }
                    } else if (stream === "error") {
                        // error
                        setStreaming(false);
                        const errMsg = (data === null || data === void 0 ? void 0 : data.message) || (data === null || data === void 0 ? void 0 : data.error) || "Unknown error";
                        if (streamBuf.current) {
                            const errId = streamBuf.current.id;
                            setMessages({
                                "useChat.useEffect.unsub": (prev)=>prev.map({
                                        "useChat.useEffect.unsub": (m)=>m.id === errId ? {
                                                ...m,
                                                content: m.content + "\n\n**Error:** ".concat(errMsg),
                                                streaming: false
                                            } : m
                                    }["useChat.useEffect.unsub"])
                            }["useChat.useEffect.unsub"]);
                            streamBuf.current = null;
                        }
                    }
                }
            }["useChat.useEffect.unsub"]);
            return unsub;
        }
    }["useChat.useEffect"], [
        client,
        sessionKey
    ]);
    // Message queue for messages sent while streaming — persist to localStorage
    const queueRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(({
        "useChat.useRef[queueRef]": ()=>{
            if (queueStorageKey && "object" !== "undefined") {
                try {
                    const saved = localStorage.getItem(queueStorageKey);
                    return saved ? JSON.parse(saved) : [];
                } catch (e) {
                    return [];
                }
            }
            return [];
        }
    })["useChat.useRef[queueRef]"]());
    const processingQueue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(false);
    const persistQueue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useChat.useCallback[persistQueue]": ()=>{
            if (!queueStorageKey) return;
            if (queueRef.current.length > 0) {
                localStorage.setItem(queueStorageKey, JSON.stringify(queueRef.current));
            } else {
                localStorage.removeItem(queueStorageKey);
            }
        }
    }["useChat.useCallback[persistQueue]"], [
        queueStorageKey
    ]);
    // Actually send a message to the gateway
    const doSend = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useChat.useCallback[doSend]": async (text, msgId)=>{
            if (!client || state !== "connected") return;
            // Mark message as no longer queued
            setMessages({
                "useChat.useCallback[doSend]": (prev)=>prev.map({
                        "useChat.useCallback[doSend]": (m)=>m.id === msgId ? {
                                ...m,
                                queued: false
                            } : m
                    }["useChat.useCallback[doSend]"])
            }["useChat.useCallback[doSend]"]);
            setStreaming(true);
            try {
                await client.request("chat.send", {
                    message: text,
                    idempotencyKey: "awf-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2)),
                    sessionKey
                });
            } catch (err) {
                console.error("[AWF] chat.send error:", String(err));
                setStreaming(false);
            }
        }
    }["useChat.useCallback[doSend]"], [
        client,
        state,
        sessionKey
    ]);
    // Process queue: send next message when streaming ends
    const processQueue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useChat.useCallback[processQueue]": async ()=>{
            if (processingQueue.current) return;
            processingQueue.current = true;
            while(queueRef.current.length > 0){
                const next = queueRef.current.shift();
                persistQueue();
                // Check if message was cancelled (removed from messages)
                const stillExists = await new Promise({
                    "useChat.useCallback[processQueue]": (resolve)=>{
                        setMessages({
                            "useChat.useCallback[processQueue]": (prev)=>{
                                resolve(prev.some({
                                    "useChat.useCallback[processQueue]": (m)=>m.id === next.id
                                }["useChat.useCallback[processQueue]"]));
                                return prev;
                            }
                        }["useChat.useCallback[processQueue]"]);
                    }
                }["useChat.useCallback[processQueue]"]);
                if (stillExists) {
                    await doSend(next.text, next.id);
                    // Wait for streaming to finish before sending next
                    await new Promise({
                        "useChat.useCallback[processQueue]": (resolve)=>{
                            const check = {
                                "useChat.useCallback[processQueue].check": ()=>{
                                    // Poll streaming state - resolve when not streaming
                                    setTimeout({
                                        "useChat.useCallback[processQueue].check": ()=>{
                                            setStreaming({
                                                "useChat.useCallback[processQueue].check": (s)=>{
                                                    if (!s) resolve();
                                                    else check();
                                                    return s;
                                                }
                                            }["useChat.useCallback[processQueue].check"]);
                                        }
                                    }["useChat.useCallback[processQueue].check"], 200);
                                }
                            }["useChat.useCallback[processQueue].check"];
                            check();
                        }
                    }["useChat.useCallback[processQueue]"]);
                }
            }
            processingQueue.current = false;
        }
    }["useChat.useCallback[processQueue]"], [
        doSend
    ]);
    // Send message (queues if currently streaming)
    const sendMessage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useChat.useCallback[sendMessage]": (text)=>{
            if (!client || state !== "connected" || !text.trim()) return;
            const msgId = "user-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2));
            const userMsg = {
                id: msgId,
                role: "user",
                content: text,
                timestamp: new Date().toISOString(),
                toolCalls: [],
                queued: streaming
            };
            setMessages({
                "useChat.useCallback[sendMessage]": (prev)=>[
                        ...prev,
                        userMsg
                    ]
            }["useChat.useCallback[sendMessage]"]);
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
        }
    }["useChat.useCallback[sendMessage]"], [
        client,
        state,
        streaming,
        doSend
    ]);
    // When streaming ends, process queue
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useChat.useEffect": ()=>{
            if (!streaming && queueRef.current.length > 0) {
                processQueue();
            }
        }
    }["useChat.useEffect"], [
        streaming,
        processQueue
    ]);
    // Cancel a queued message
    const cancelQueued = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useChat.useCallback[cancelQueued]": (msgId)=>{
            queueRef.current = queueRef.current.filter({
                "useChat.useCallback[cancelQueued]": (q)=>q.id !== msgId
            }["useChat.useCallback[cancelQueued]"]);
            persistQueue();
            setMessages({
                "useChat.useCallback[cancelQueued]": (prev)=>prev.filter({
                        "useChat.useCallback[cancelQueued]": (m)=>m.id !== msgId
                    }["useChat.useCallback[cancelQueued]"])
            }["useChat.useCallback[cancelQueued]"]);
        }
    }["useChat.useCallback[cancelQueued]"], [
        persistQueue
    ]);
    // Abort
    const abort = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useChat.useCallback[abort]": async ()=>{
            if (!client || state !== "connected") return;
            try {
                await client.request("chat.abort", {
                    sessionKey
                });
            } catch (e) {
            // silently fail
            }
            setStreaming(false);
        }
    }["useChat.useCallback[abort]"], [
        client,
        state,
        sessionKey
    ]);
    // Add a user message to the display (for external callers like attachment sends)
    const addUserMessage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useChat.useCallback[addUserMessage]": (text, attachments)=>{
            const msgId = "user-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2));
            const userMsg = {
                id: msgId,
                role: "user",
                content: text,
                timestamp: new Date().toISOString(),
                toolCalls: [],
                queued: streaming,
                attachments
            };
            setMessages({
                "useChat.useCallback[addUserMessage]": (prev)=>[
                        ...prev,
                        userMsg
                    ]
            }["useChat.useCallback[addUserMessage]"]);
            if (!streaming) {
                setStreaming(true);
            }
        }
    }["useChat.useCallback[addUserMessage]"], [
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
_s4(useChat, "Idbd+vbhjOJuW6qmYkdTbVXUuQM=", false, function() {
    return [
        useGateway
    ];
});
var _c;
__turbopack_context__.k.register(_c, "GatewayProvider");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/lib/utils.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "cn",
    ()=>cn
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$clsx$40$2$2e$1$2e$1$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$tailwind$2d$merge$40$3$2e$5$2e$0$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/tailwind-merge@3.5.0/node_modules/tailwind-merge/dist/bundle-mjs.mjs [app-client] (ecmascript)");
;
;
function cn() {
    for(var _len = arguments.length, inputs = new Array(_len), _key = 0; _key < _len; _key++){
        inputs[_key] = arguments[_key];
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$tailwind$2d$merge$40$3$2e$5$2e$0$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["twMerge"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$clsx$40$2$2e$1$2e$1$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["clsx"])(inputs));
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/components/ui/tooltip.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
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
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@15.5.12_@babel+core@7.29.0_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/@radix-ui+react-tooltip@1.2.8_@types+react-dom@19.2.3_@types+react@19.2.14__@types+reac_9074d9fb06315b089b2bee17c4c65951/node_modules/@radix-ui/react-tooltip/dist/index.mjs [app-client] (ecmascript) <export * as Tooltip>");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/utils.ts [app-client] (ecmascript)");
"use client";
;
;
;
function TooltipProvider(param) {
    let { delayDuration = 0, ...props } = param;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Provider, {
        "data-slot": "tooltip-provider",
        delayDuration: delayDuration,
        ...props
    }, void 0, false, {
        fileName: "[project]/src/components/ui/tooltip.tsx",
        lineNumber: 13,
        columnNumber: 5
    }, this);
}
_c = TooltipProvider;
function Tooltip(param) {
    let { ...props } = param;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Root, {
        "data-slot": "tooltip",
        ...props
    }, void 0, false, {
        fileName: "[project]/src/components/ui/tooltip.tsx",
        lineNumber: 24,
        columnNumber: 10
    }, this);
}
_c1 = Tooltip;
function TooltipTrigger(param) {
    let { ...props } = param;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Trigger, {
        "data-slot": "tooltip-trigger",
        ...props
    }, void 0, false, {
        fileName: "[project]/src/components/ui/tooltip.tsx",
        lineNumber: 30,
        columnNumber: 10
    }, this);
}
_c2 = TooltipTrigger;
function TooltipContent(param) {
    let { className, sideOffset = 0, children, ...props } = param;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Portal, {
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Content, {
            "data-slot": "tooltip-content",
            sideOffset: sideOffset,
            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance", className),
            ...props,
            children: [
                children,
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$15$2e$5$2e$12_$40$babel$2b$core$40$7$2e$29$2e$0_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$radix$2d$ui$2b$react$2d$tooltip$40$1$2e$2$2e$8_$40$types$2b$react$2d$dom$40$19$2e$2$2e$3_$40$types$2b$react$40$19$2e$2$2e$14_$5f40$types$2b$reac_9074d9fb06315b089b2bee17c4c65951$2f$node_modules$2f40$radix$2d$ui$2f$react$2d$tooltip$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__Tooltip$3e$__["Tooltip"].Arrow, {
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
_c3 = TooltipContent;
;
var _c, _c1, _c2, _c3;
__turbopack_context__.k.register(_c, "TooltipProvider");
__turbopack_context__.k.register(_c1, "Tooltip");
__turbopack_context__.k.register(_c2, "TooltipTrigger");
__turbopack_context__.k.register(_c3, "TooltipContent");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=src_587cbd64._.js.map