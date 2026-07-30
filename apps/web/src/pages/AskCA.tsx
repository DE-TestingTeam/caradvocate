import * as React from 'react';
import { Composer } from '@/components/ask/Composer';
import { MessageBubble, TypingBubble } from '@/components/ask/MessageBubble';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { sendChatMessage } from '@/lib/api';
import { vehicleName } from '@/lib/format';
import type { ChatMessage } from '@caradvocate/shared';

/**
 * Ask CA.
 *
 * The conversation lives here and nowhere else. Nothing is fetched on mount and nothing
 * is stored server-side, so leaving this screen ends the conversation -- which is the
 * intent, and the reason there is no history request and no loading skeleton. The
 * subtitle says so, because an owner who assumes their transcript is being kept would
 * be surprised by the opposite.
 */
export function AskCAPage() {
  const vehicle = useVehicle();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [pending, setPending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string>();
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Guarded: scrollIntoView is missing in some non-browser test environments.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, pending]);

  async function handleSend(text: string) {
    const optimistic: ChatMessage = { id: `local_${Date.now()}`, role: 'user', text };
    // Captured before the optimistic turn is added, so the question is not sent twice.
    const history = messages.map((message) => ({ role: message.role, text: message.text }));

    setMessages((prev) => [...prev, optimistic]);
    setPending(true);
    setSendError(undefined);

    try {
      const { user, assistant } = await sendChatMessage(text, history);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), user, assistant]);
    } catch (cause) {
      // Roll the optimistic message back rather than leaving an unanswered question.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setSendError(cause instanceof Error ? cause.message : 'Message could not be sent.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col">
      <div className="shrink-0 border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Ask CA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {`Ask anything about your ${vehicleName(vehicle)}`}
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && !pending ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium">
              {`Ask about a noise, a warning light, or a quote you have been given.`}
            </p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Answers use your car&rsquo;s own recalls, owner-reported problems and service
              history. This conversation is not saved &mdash; it clears when you leave.
            </p>
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {pending && <TypingBubble />}
        {sendError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {sendError}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0">
        <Composer onSend={handleSend} disabled={pending} />
      </div>
    </div>
  );
}
