import * as React from 'react';
import { Composer } from '@/components/ask/Composer';
import { MessageBubble, TypingBubble } from '@/components/ask/MessageBubble';
import { Skeleton } from '@/components/ui/skeleton';
import { getChatHistory, getVehicle, sendChatMessage } from '@/lib/api';
import { vehicleName } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { ChatMessage } from '@/types';

export function AskCAPage() {
  const vehicle = useApi(getVehicle);
  const history = useApi(getChatHistory, []);
  const [messages, setMessages] = React.useState<ChatMessage[] | undefined>();
  const [pending, setPending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  // Seed local state once from the api, then own it locally so sends feel instant.
  React.useEffect(() => {
    if (history.data && !messages) setMessages(history.data);
  }, [history.data, messages]);

  React.useEffect(() => {
    // Guarded: scrollIntoView is missing in some non-browser test environments.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, pending]);

  async function handleSend(text: string) {
    const optimistic: ChatMessage = { id: `local_${Date.now()}`, role: 'user', text };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    setPending(true);

    const { assistant } = await sendChatMessage(text);
    setMessages((prev) => [...(prev ?? []), assistant]);
    setPending(false);
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col">
      <div className="shrink-0 border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Ask CA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {vehicle.data ? `Ask anything about your ${vehicleName(vehicle.data)}` : 'Ask anything about your car'}
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages ? (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        ) : (
          <div className="space-y-4">
            <Skeleton className="ml-auto h-20 w-3/4 rounded-lg" />
            <Skeleton className="h-32 w-[90%] rounded-lg" />
            <Skeleton className="ml-auto h-16 w-2/3 rounded-lg" />
          </div>
        )}
        {pending && <TypingBubble />}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0">
        <Composer onSend={handleSend} disabled={pending || !messages} />
      </div>
    </div>
  );
}
