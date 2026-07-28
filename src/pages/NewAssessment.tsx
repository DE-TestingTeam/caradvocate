import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { QuoteStep, type QuoteChoice } from '@/components/assessments/QuoteStep';
import { RepairPicker } from '@/components/assessments/RepairPicker';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { createAssessment, getRepairCatalog } from '@/lib/api';
import { invalidateAll, useApi } from '@/lib/useApi';

export function NewAssessmentPage() {
  const navigate = useNavigate();
  const catalog = useApi(getRepairCatalog);

  const [repairName, setRepairName] = React.useState<string>();
  const [choice, setChoice] = React.useState<QuoteChoice>();
  const [amount, setAmount] = React.useState('');
  const [fileName, setFileName] = React.useState<string>();
  const [submitting, setSubmitting] = React.useState(false);

  const quoteReady = choice === 'no' || (choice === 'yes' && Number(amount) > 0);
  const canSubmit = Boolean(repairName) && quoteReady && !submitting;

  async function handleSubmit() {
    if (!repairName || !canSubmit) return;
    setSubmitting(true);
    const created = await createAssessment({
      repairName,
      quoteAmount: choice === 'yes' ? Number(amount) : undefined,
      quoteFileName: fileName,
    });
    invalidateAll();
    navigate(`/assessments/${created.id}`);
  }

  return (
    <div>
      <PageHeader title="New Repair Assessment" backTo="/assessments" backLabel="Back to Repair Assessment" />
      <Separator className="mb-6" />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Step 1: What repair do you need?
        </h2>
        {catalog.data ? (
          <RepairPicker items={catalog.data} value={repairName} onChange={setRepairName} />
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Step 2: Have a quote from a shop?
        </h2>
        <QuoteStep
          choice={choice}
          onChoiceChange={setChoice}
          amount={amount}
          onAmountChange={setAmount}
          fileName={fileName}
          onFileChange={setFileName}
        />
      </section>

      <Button size="lg" className="mt-8 w-full" disabled={!canSubmit} onClick={handleSubmit}>
        {submitting ? 'Starting…' : 'Start assessment'}
      </Button>
    </div>
  );
}
