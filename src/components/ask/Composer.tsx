import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function Composer({ onSend, disabled = false }: ComposerProps) {
  const [value, setValue] = React.useState('');
  const trimmed = value.trim();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t bg-background pt-3">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
