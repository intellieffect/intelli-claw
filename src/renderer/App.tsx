import { GatewayProvider } from "@/lib/gateway/hooks";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatView } from "@/components/chat/chat-view";

export function App() {
  return (
    <GatewayProvider>
      <TooltipProvider>
        <ChatView />
      </TooltipProvider>
    </GatewayProvider>
  );
}
