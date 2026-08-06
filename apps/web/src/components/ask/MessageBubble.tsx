import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { UrgencyCallout } from './UrgencyCallout';
import type { ChatMessage } from '@caradvocate/shared';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const navigate = useNavigate();

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

        {message.urgency && <UrgencyCallout level={message.urgency.level} text={message.urgency.text} />}

        {message.cta && (
          <Button variant="outline" className="w-full" onClick={() => navigate('/assessments/new')}>
            {message.cta.label}
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </Card>
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
