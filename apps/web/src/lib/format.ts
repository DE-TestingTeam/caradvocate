/** All currency / mileage / date formatting lives here. Do not inline toLocaleString elsewhere. */

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** 14200 -> "$14,200" */
export function formatCurrency(value: number): string {
  return currency.format(value);
}

/** 360, 660 -> "$360-$660" (en dash) */
export function formatCurrencyRange(low: number, high: number): string {
  return `${formatCurrency(low)}–${formatCurrency(high)}`;
}

/** 68400 -> "68,400 mi" */
export function formatMileage(value: number): string {
  return `${value.toLocaleString('en-US')} mi`;
}

/**
 * 1499, 'USD' -> "$14.99". Cents in, so nothing upstream holds a float. Keeps the cents that
 * formatCurrency rounds away: "$15" for $14.99 is the wrong number on a screen where someone
 * is deciding whether to pay.
 */
export function formatPrice(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format(cents / 100);
}

/** "2026-06-14" -> "Jun 2026" */
export function formatMonthYear(iso: string): string {
  const d = parseIso(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** "2025-01-15" -> "Jan 15, 2025" */
export function formatLongDate(iso: string): string {
  const d = parseIso(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Colon-delimited NHTSA caps, cased for reading with every segment kept:
 * "FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP" -> "Fuel System, Gasoline · Delivery · Fuel Pump"
 */
export function formatRecallComponent(component: string): string {
  return component
    .split(':')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(titleCaseSegment)
    .join(' · ');
}

function titleCaseSegment(segment: string): string {
  return segment.replace(/[A-Za-z]+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** Acronyms worth keeping upright when un-shouting NHTSA prose. */
const KEEP_UPPERCASE = new Set(['NHTSA', 'VIN', 'ABS', 'SUV', 'USA', 'LED', 'GPS', 'AWD', 'FWD', 'RWD', 'TPMS']);

/**
 * Un-shouts NHTSA prose: older records are entirely capitals, and owner complaints are worse
 * since plenty of people type in caps regardless of the year. Only overwhelmingly uppercase
 * text is rewritten, so sentence-case prose passes through untouched. Acronyms in
 * KEEP_UPPERCASE survive; rarer ones come out capitalised as a word, which still beats a
 * shouted paragraph.
 */
export function formatNhtsaProse(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 12) return text;

  const uppercaseShare = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (uppercaseShare < 0.85) return text;

  const lowered = text.replace(/[A-Z]+/g, (word) => (KEEP_UPPERCASE.has(word) ? word : word.toLowerCase()));
  // Capitalise the first letter of the text and of anything following . ! or ?
  return lowered.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}

/**
 * 1.5 -> "1.5 hrs", 1 -> "1 hr", 0.6 -> "36 min".
 *
 * Whole and part hours keep the decimal because that is how a shop quotes labour ("1.5 hours"),
 * and matching their wording is what lets an owner compare the two. Under an hour it flips to
 * minutes: "0.6 hrs" is a conversion sum on a screen someone is reading to decide whether a
 * quote is fair, and a third of the jobs priced here fall below the hour.
 */
export function formatHours(hours: number): string {
  if (hours > 0 && hours < 1) {
    return `${Math.round(hours * 60)} min`;
  }
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}

/** "2HGFC2F53KH123456" -> "2HGFC2F53KH••••••" */
export function maskVin(vin: string, visible = 11): string {
  const shown = vin.slice(0, visible);
  return shown + '•'.repeat(Math.max(0, vin.length - visible));
}

/** "2HGFC2F53KH124821" -> "••••4821" */
export function maskVinTail(vin: string, visible = 4): string {
  return '•'.repeat(4) + vin.slice(-visible);
}

/**
 * "2019 Honda Civic EX" from a vehicle-ish shape.
 *
 * A trim that just repeats the model is dropped, because VIN decoding falls back to NHTSA's
 * `Series` field when there is no real trim and that often holds the model name again -- a
 * 2011 Pathfinder decodes with trim "Pathfinder" and would otherwise read "2011 NISSAN
 * Pathfinder Pathfinder". Guarded here as well as at the decode so existing rows read
 * correctly without having to be rewritten.
 */
export function vehicleName(v: { year: number; make: string; model: string; trim?: string }): string {
  const trim = v.trim?.trim();
  const redundant = trim !== undefined && trim.toLowerCase() === v.model.trim().toLowerCase();

  return [v.year, v.make, v.model, redundant ? undefined : trim].filter(Boolean).join(' ');
}

/** Today as an ISO date string (no time component). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIso(iso: string): Date {
  // A time makes this parse as local rather than UTC, which would shift dates backwards for
  // negative-offset timezones.
  return new Date(`${iso}T12:00:00`);
}
