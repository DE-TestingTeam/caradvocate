import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ComposerProps {
  /**
   * Controlled by the page rather than held here, so a send that fails can put the owner's text
   * back in the box instead of losing it.
   */
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function Composer({ value, onChange, onSend, disabled = false }: ComposerProps) {
  const trimmed = value.trim();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || disabled) return;
    // The page clears the box: it owns the value, and on failure it puts this text back.
    onSend(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t bg-background pt-3">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ask about a symptom, repair, or your car…"
        aria-label="Message"
        autoComplete="off"
      />
      <Button type="submit" size="icon" disabled={!trimmed || disabled} aria-label="Send message">
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
