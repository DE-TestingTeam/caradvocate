import * as React from 'react';
import { FileText, Upload } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type QuoteChoice = 'yes' | 'no';

interface QuoteStepProps {
  choice: QuoteChoice | undefined;
  onChoiceChange: (choice: QuoteChoice) => void;
  amount: string;
  onAmountChange: (amount: string) => void;
  fileName: string | undefined;
  onFileChange: (fileName: string | undefined) => void;
}

export function QuoteStep({
  choice,
  onChoiceChange,
  amount,
  onAmountChange,
  fileName,
  onFileChange,
}: QuoteStepProps) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /** The file is captured for display only -- nothing parses the PDF in this build. */
  function acceptFile(files: FileList | null) {
    const file = files?.[0];
    if (file) onFileChange(file.name);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onChoiceChange('yes')}
        className={cn(
          'w-full rounded-lg border p-4 text-left transition-colors',
          choice === 'yes' ? 'border-2 border-foreground' : 'bg-muted/50 hover:bg-accent',
        )}
      >
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 shrink-0" />
          <span className="text-base font-semibold">Yes, I have a quote</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Upload or enter your quote for a fairness check</p>
      </button>

      {choice === 'yes' && (
        <div className="space-y-4 pl-1">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              acceptFile(e.dataTransfer.files);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
              dragging ? 'border-foreground bg-accent' : 'hover:bg-muted/50',
            )}
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-base font-semibold">{fileName ?? 'Upload quote PDF'}</span>
            <span className="text-sm text-muted-foreground">
              {fileName ? 'Tap to replace' : 'or drag and drop here'}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => acceptFile(e.target.files)}
            />
          </div>

          {/* NOTE: not in the wireframes. The detail screen needs a numeric quote,
              and nothing here parses the uploaded PDF. */}
          <div className="space-y-2">
            <Label htmlFor="quote-amount">Quote total</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="quote-amount"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                placeholder="320"
                className="pl-7"
              />
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onChoiceChange('no')}
        className={cn(
          'w-full rounded-lg border p-4 text-left transition-colors',
          choice === 'no' ? 'border-2 border-foreground' : 'bg-muted/50 hover:bg-accent',
        )}
      >
        <span className="text-base font-semibold">No, not yet</span>
        <p className="mt-1 text-sm text-muted-foreground">Get expected costs before visiting a shop</p>
      </button>
    </div>
  );
}
