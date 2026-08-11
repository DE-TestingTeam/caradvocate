import * as React from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Composer } from '@/components/ask/Composer';
import { MessageBubble, PreviewBubble, TypingBubble } from '@/components/ask/MessageBubble';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { Button } from '@/components/ui/button';
import { sendChatMessage } from '@/lib/api';
import { loadTranscript, saveTranscript } from '@/lib/chatTranscript';
import { vehicleShortName } from '@/lib/format';
import type { ChatMessage } from '@caradvocate/shared';

/**
 * Ask CA. Nothing is fetched on mount and nothing is stored server-side -- hence no history
 * request and no loading skeleton.
 *
 * The conversation is held by the browser for the life of the tab (see lib/chatTranscript.ts),
 * so stepping over to My Car to check a recall and coming back does not throw the thread away.
 * Closing the tab does. The subtitle says exactly that, because an owner who assumes either more
 * or less persistence than they get would be badly served by the surprise.
 *
 * `?q=` ARRIVES IN THE COMPOSER, NOT IN THE THREAD. My Car's model-watch row sends people here
 * with a question about what owners report on their model, and it lands as a draft: on screen,
 * editable, waiting on the send button. Nothing is sent for the owner. That is the same rule
 * `?repair=` follows on the Repair Cost Checker, and it matters more here -- a thread that
 * opened with a question they did not write, already answered, would be the first thing they
 * read, and it would have spent a model call to get there.
 */
export function AskCAPage() {
  const vehicle = useVehicle();
  // Restored once, on mount. Reading straight into useState rather than in an effect means the
  // thread is on screen for the first paint instead of flashing the empty state first.
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => loadTranscript(vehicle.id));
  const [pending, setPending] = React.useState(false);
  const [preview, setPreview] = React.useState('');
  const [sendError, setSendError] = React.useState<string>();
  const bottomRef = React.useRef<HTMLDivElement>(null);

  /*
   * An INITIAL value, read once. Held in state from here on, so editing it, sending it, or
   * having a failed send hand it back all work on the owner's text rather than re-reading a URL
   * that has not changed. The param stays in the address bar rather than being cleared, so a
   * refresh still arrives with the question -- as it does on the Repair Cost Checker.
   */
  const [params] = useSearchParams();
  const prefill = params.get('q') ?? '';
  const [draft, setDraft] = React.useState(prefill);

  React.useEffect(() => {
    // Guarded: scrollIntoView is missing in some non-browser test environments.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, pending, preview]);

  // Written on every change rather than on unmount: a crashed or force-closed tab never runs
  // cleanup, and that is exactly the case where losing the thread would be most annoying.
  React.useEffect(() => {
    saveTranscript(vehicle.id, messages);
  }, [vehicle.id, messages]);

  /**
   * Start over.
   *
   * WHY THERE IS A CONTROL AT ALL. Until now the only routes to a clean slate were closing the
   * tab or signing out, so an owner moving from a steering complaint to a brake quote carried
   * the previous turns along as context whether they helped or not -- the API sends the last 10
   * messages with every question. This is the owner saying "that topic is finished", which is
   * a thing only they know.
   *
   * NO CONFIRMATION STEP, deliberately. `LogServiceDialog` deletes a persisted service record
   * on one click with no second prompt; a tab-scoped transcript that was never stored anywhere
   * is strictly less destructive than that, and guarding it harder than the app guards its own
   * database rows would be the wrong way round. Re-asking costs a model call and about six
   * seconds, which is the whole of the downside.
   *
   * THE DRAFT SURVIVES. This clears what was SAID, not what is being typed. Someone who has a
   * half-written question in the box and wants the history gone should not lose the sentence
   * they are in the middle of -- the same instinct as `handleSend`'s failure path, which hands
   * the text back rather than swallowing it.
   *
   * `saveTranscript` turns an empty list into a `removeItem`, so this clears storage too rather
   * than parking an empty array there.
   */
  function handleNewConversation() {
    setMessages([]);
    setSendError(undefined);
  }

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
      <div className="flex shrink-0 items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold">Ask CA</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {`Ask anything about your ${vehicleShortName(vehicle)}`}
          </p>
        </div>

        {/*
          Only once there is something to clear -- on an empty chat this is a button whose only
          possible effect is nothing, sitting next to the sentence inviting the first question.

          Disabled mid-answer, and that is a correctness guard rather than politeness: `handleSend`
          appends the finished turn to whatever `messages` holds when the stream lands, so clearing
          under a request in flight would empty the thread and then drop a lone reply into it.
        */}
        {messages.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={handleNewConversation}
            className="shrink-0"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New conversation
          </Button>
        )}
      </div>

      {/* NOTE: aria-live so a screen reader announces the answer -- there is no other cue that
          one arrived, and `polite` waits for the reader to finish rather than cutting in. */}
      <div className="flex-1 space-y-4 overflow-y-auto py-4" aria-live="polite" aria-atomic="false">
        {messages.length === 0 && !pending ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium">
              {`Ask about a noise, a warning light, or a quote you have been given.`}
            </p>
            {/*
              Splits what is the model's from what is this car's, because the two carry
              different weight. Recalls and owner complaints are pulled by year, make and model
              -- they describe cars like yours, and a recall in that set may cover only certain
              VINs. Only the upkeep schedule and service history are this car's own. Saying "your
              car's own recalls" claimed a per-VIN answer nothing in the stack actually has.
            */}
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Answers use recalls and owner-reported problems for your year, make and model,
              along with your own service history, and each one shows what it drew on. Nothing is
              saved to your account &mdash; the conversation stays in this tab and clears when you
              close it.
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
        {/* Focused only when something was prefilled. An empty composer that grabs focus on
            arrival opens the keyboard over half the screen on a phone, for someone who has not
            said they want to type yet; a composer holding a question they did not write needs
            the caret in it, or editing that question starts with hunting for where to click. */}
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          disabled={pending}
          autoFocus={prefill !== ''}
        />
      </div>
    </div>
  );
}
