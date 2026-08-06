import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { UrgencyCallout } from './UrgencyCallout';
import type { ChatMessage } from '@caradvocate/shared';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const navigate = useNavigate();
  // Bound once so the click handler below narrows -- reading message.cta inside the callback
  // widens it back to possibly-undefined.
  const cta = message.cta;

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-muted px-4 py-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">User</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <Card className="max-w-[90%] space-y-3 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Car Advocate Assistant
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>

        {message.sources && message.sources.length > 0 && <SourceSummary sources={message.sources} />}

        {message.urgency && <UrgencyCallout level={message.urgency.level} text={message.urgency.text} />}

        {cta && (
          <div className="space-y-1.5">
            <Button className="w-full" onClick={() => navigate(assessmentHref(cta))}>
              {cta.label}
              <ArrowRight className="h-4 w-4" />
            </Button>
            {cta.prefill && (
              // Says what the button is about to do, so a preselection is never a surprise the
              // owner has to spot on the next screen.
              <p className="text-center text-[11px] text-muted-foreground">
                {`Opens with ${cta.prefill.repairName}`}
                {cta.prefill.quoteAmount !== undefined
                  ? ` and your $${cta.prefill.quoteAmount.toLocaleString('en-US')} quote`
                  : ''}
                {' — you can change it'}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Where the CTA points, carrying whatever the assistant could work out about the question.
 *
 * Query parameters rather than router state, so the destination behaves the same whether it was
 * reached by tapping the button, reloading, or sharing the link. The form treats them as initial
 * values only -- see NewAssessmentPage.
 */
function assessmentHref(cta: NonNullable<ChatMessage['cta']>): string {
  if (!cta.prefill) return '/assessments/new';

  const params = new URLSearchParams({ repair: cta.prefill.repairId });
  if (cta.prefill.quoteAmount !== undefined) params.set('quote', String(cta.prefill.quoteAmount));
  return `/assessments/new?${params.toString()}`;
}

/**
 * What the answer was grounded in, under the answer itself.
 *
 * The product's claim is that Ask CA does not invent things, and until now the owner had to
 * take that on trust. These labels and their counts are written by the API from the facts it
 * actually assembled -- the model only picks which of them applied -- so the line cannot cite
 * something the app did not have.
 *
 * NOTE: no wireframe for this. Deliberately quiet: it is reassurance for anyone who looks, not
 * something to read before the answer, so it sits below the text at the smallest legible size.
 */
function SourceSummary({ sources }: { sources: NonNullable<ChatMessage['sources']> }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 border-t pt-2.5 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wide">Based on</span>
      {sources.map((source, index) => (
        <span key={source.kind}>
          {source.label}
          {index < sources.length - 1 && <span aria-hidden="true"> ·</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * The answer as it is being written. Deliberately not a MessageBubble: this is unvalidated model
 * output, so it renders text and nothing else -- no urgency callout, no CTA. Those only ever come
 * from the finished turn the API validated, which replaces this the moment it arrives.
 *
 * NOTE: no wireframe for this state. It matches the assistant bubble so the reply does not jump
 * when the real one lands, minus the label, which would flicker in and out for a second.
 */
export function PreviewBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <Card className="max-w-[90%] space-y-3 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Car Advocate Assistant
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {text}
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-muted-foreground/60 align-text-bottom" />
        </p>
      </Card>
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="flex justify-start">
      <Card className="flex items-center gap-1.5 px-4 py-4" aria-label="Assistant is typing">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </Card>
    </div>
  );
}
