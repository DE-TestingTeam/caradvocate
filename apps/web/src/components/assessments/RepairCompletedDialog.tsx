import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { completeAssessment } from '@/lib/api';
import { completionCost } from '@/lib/assessment';
import { formatCurrency, formatLongDate, todayIso } from '@/lib/format';
import { invalidateAll } from '@/lib/useApi';
import type { Assessment } from '@caradvocate/shared';

interface RepairCompletedDialogProps {
  assessment: Assessment | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RepairCompletedDialog({
  assessment,
  open,
  onOpenChange,
}: RepairCompletedDialogProps) {
  const navigate = useNavigate();
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const cost = assessment ? completionCost(assessment) : 0;

  // Write the record as soon as the dialog opens -- the copy is past tense.
  React.useEffect(() => {
    if (!open || !assessment || saved) return;
    let active = true;
    completeAssessment(assessment.id, cost).then(
      () => {
        if (!active) return;
        invalidateAll();
        setSaved(true);
      },
      (cause: Error) => {
        if (!active) return;
        setError(cause.message);
      },
    );
    return () => {
      active = false;
    };
  }, [open, assessment, saved, cost]);

  React.useEffect(() => {
    if (!open) {
      setSaved(false);
      setError(undefined);
    }
  }, [open]);

  if (!assessment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="gap-5">
        <DialogHeader>
          <DialogTitle>
            {error ? "Could not save" : "Repair Completed"}
          </DialogTitle>
          <DialogDescription>
            {error ??
              "Your service history on My Car has been updated with this repair."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/50 p-3">
          <div className="font-semibold">{assessment.repairName}</div>
          <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">
            <span>{formatLongDate(assessment.completedAt ?? todayIso())}</span>
            <span className="font-semibold text-foreground">
              {formatCurrency(cost)}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
          {!error && (
            <button
              type="button"
              className="mx-auto flex items-center gap-1.5 text-sm font-medium underline underline-offset-4"
              onClick={() => {
                onOpenChange(false);
                navigate("/my-car");
              }}
            >
              View Service History
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
