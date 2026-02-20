import type { Metadata, Viewport } from "next";
import { GatewayProvider } from "@/lib/gateway/hooks";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "AWF - Agentic Workflow",
  description: "OpenClaw Agentic Workflow",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AWF",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="antialiased">
        <GatewayProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </GatewayProvider>
      </body>
    </html>
  );
}
