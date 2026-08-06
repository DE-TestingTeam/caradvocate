import * as React from 'react';
import { Composer } from '@/components/ask/Composer';
import { MessageBubble, PreviewBubble, TypingBubble } from '@/components/ask/MessageBubble';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { sendChatMessage } from '@/lib/api';
import { loadTranscript, saveTranscript } from '@/lib/chatTranscript';
import { vehicleName } from '@/lib/format';
import type { ChatMessage } from '@caradvocate/shared';

/**
 * Ask CA. Nothing is fetched on mount and nothing is stored server-side -- hence no history
 * request and no loading skeleton.
 *
 * The conversation is held by the browser for the life of the tab (see lib/chatTranscript.ts),
 * so stepping over to My Car to check a recall and coming back does not throw the thread away.
 * Closing the tab does. The subtitle says exactly that, because an owner who assumes either more
 * or less persistence than they get would be badly served by the surprise.
 */
export function AskCAPage() {
  const vehicle = useVehicle();
  // Restored once, on mount. Reading straight into useState rather than in an effect means the
  // thread is on screen for the first paint instead of flashing the empty state first.
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => loadTranscript(vehicle.id));
  const [pending, setPending] = React.useState(false);
  const [preview, setPreview] = React.useState('');
  const [sendError, setSendError] = React.useState<string>();
  const [draft, setDraft] = React.useState('');
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Guarded: scrollIntoView is missing in some non-browser test environments.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, pending, preview]);

  // Written on every change rather than on unmount: a crashed or force-closed tab never runs
  // cleanup, and that is exactly the case where losing the thread would be most annoying.
  React.useEffect(() => {
    saveTranscript(vehicle.id, messages);
  }, [vehicle.id, messages]);

  async function handleSend(text: string) {
    const optimistic: ChatMessage = { id: `local_${Date.now()}`, role: 'user', text };
    // Captured before the optimistic turn is added, so the question is not sent twice.
    const history = messages.map((message) => ({ role: message.role, text: message.text }));

    setMessages((prev) => [...prev, optimistic]);
    setPending(true);
    setPreview('');
    setSendError(undefined);
    setDraft('');

    try {
      // The preview is the answer being written; it is replaced wholesale by the validated turn
      // below, which is the only thing that can carry an urgency banner or the CTA.
      const { user, assistant } = await sendChatMessage(text, history, setPreview);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), user, assistant]);
    } catch (cause) {
      // Roll the optimistic message back rather than leaving an unanswered question -- but hand
      // the owner their text back in the composer. Losing what they typed on the one path where
      // they have to retry is the worst moment to make them type it again.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setSendError(cause instanceof Error ? cause.message : 'Message could not be sent.');
    } finally {
      setPending(false);
      setPreview('');
    }
  }

  return (
    // The composer stays put while the transcript scrolls under it, so this fills the viewport
    // rather than growing with the conversation. 5.5rem is the shell's own vertical padding
    // (pt-6 + pb-16). It was 9rem when a 3.5rem top bar sat above; the nav moved to the side
    // and takes width instead, so that allowance would now just leave a gap under the composer.
    <div className="flex h-[calc(100dvh-5.5rem)] flex-col">
      <div className="shrink-0 border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Ask CA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {`Ask anything about your ${vehicleName(vehicle)}`}
        </p>
      </div>

      {/* NOTE: aria-live so a screen reader announces the answer -- there is no other cue that
          one arrived, and `polite` waits for the reader to finish rather than cutting in. */}
      <div className="flex-1 space-y-4 overflow-y-auto py-4" aria-live="polite" aria-atomic="false">
        {messages.length === 0 && !pending ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium">
              {`Ask about a noise, a warning light, or a quote you have been given.`}
            </p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Answers use your car&rsquo;s own recalls, owner-reported problems and service
              history, and each one shows what it drew on. Nothing is saved to your account
              &mdash; the conversation stays in this tab and clears when you close it.
            </p>
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {pending && (preview ? <PreviewBubble text={preview} /> : <TypingBubble />)}
        {sendError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {sendError}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0">
        <Composer value={draft} onChange={setDraft} onSend={handleSend} disabled={pending} />
      </div>
    </div>
  );
}
