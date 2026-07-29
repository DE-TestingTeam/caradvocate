/**
 * Quote evaluation -- the judgement the whole product rests on.
 *
 * This moved off the client, where it was trivially inspectable and editable.
 * It is still a placeholder: it compares the quote to a seeded benchmark range
 * and nothing more. A real implementation needs sourced parts pricing and OEM
 * labor times, and should probably weigh regional labor rates and the shop's
 * own history. See the root README for the outstanding data question.
 */
import type { AssessmentQuote, QuoteVerdict } from '@caradvocate/shared';

export interface BenchmarkFigures {
  partsTotal: number;
  laborTotal: number;
  fairTotalLow: number;
  fairTotalHigh: number;
}

/**
 * Splits the quoted total across parts and labor in the same proportion as the
 * benchmark, because shop quotes routinely arrive as a single number.
 *
 * NOTE: a quote *below* the benchmark range is reported as fair. The wireframes
 * define no "suspiciously low" verdict, and being told a cheap quote is fine is
 * the less harmful error. Revisit if the product wants to flag lowballs that
 * signal skipped work or counterfeit parts.
 */
export function evaluateQuote(amount: number, benchmark: BenchmarkFigures): AssessmentQuote {
  const verdict: QuoteVerdict = amount > benchmark.fairTotalHigh ? 'overpriced' : 'fair';

  const benchmarkTotal = benchmark.partsTotal + benchmark.laborTotal;
  const partsShare = benchmarkTotal > 0 ? Math.round(amount * (benchmark.partsTotal / benchmarkTotal)) : 0;
  const laborShare = amount - partsShare;

  return {
    amount,
    parts: partsShare,
    labor: laborShare,
    verdict,
    explanation: explain(amount, verdict, benchmark),
  };
}

function explain(amount: number, verdict: QuoteVerdict, benchmark: BenchmarkFigures): string {
  const quoted = money(amount);
  const range = `${money(benchmark.fairTotalLow)}-${money(benchmark.fairTotalHigh)}`;

  return verdict === 'overpriced'
    ? `Your quoted price of ${quoted} is above the expected range of ${range} for this repair. Both parts and labor are priced above benchmark.`
    : `Your quoted price of ${quoted} is within the expected range of ${range} for this repair. Parts and labor are both within normal bounds.`;
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
