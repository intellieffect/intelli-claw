import { GatewayProvider } from "@/lib/gateway/hooks";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatView } from "@/components/chat/chat-view";
import { CronPanel } from "@/components/settings/cron-panel";

function AppContent() {
  // Hash-based routing: #/cron → CronPanel, default → ChatView
  const hash = window.location.hash;

  if (hash === "#/cron") {
    return (
      <div className="h-dvh w-full">
        <CronPanel />
      </div>
    );
  }

  return <ChatView />;
}

export function App() {
  return (
    <GatewayProvider>
      <TooltipProvider>
        <AppContent />
      </TooltipProvider>
    </GatewayProvider>
  );
}
