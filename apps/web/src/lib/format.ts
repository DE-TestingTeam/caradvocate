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
 * NHTSA component names arrive as colon-delimited caps:
 * "FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP" -> "Fuel System, Gasoline · Delivery · Fuel Pump"
 *
 * Shouting at the owner is not a design choice we want to inherit from an upstream
 * feed, so the text is cased for reading while keeping every segment.
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
 * NHTSA wrote its older records entirely in capitals, so a 2011 recall arrives as
 * "IF THERE IS AN ENGINE OIL LEAK, THE ENGINE OIL PRESSURE WOULD DROP" -- and owner
 * complaints are worse, since plenty of people type in caps regardless of the year.
 * Modern sentence-case prose passes through untouched.
 *
 * Only text that is overwhelmingly uppercase is rewritten, so this cannot quietly
 * restyle prose that was fine to begin with. A handful of acronyms are preserved;
 * anything rarer may come out capitalised as a word, which still reads better than
 * a shouted paragraph.
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

/** 1.5 -> "1.5 hrs", 1 -> "1 hr" */
export function formatHours(hours: number): string {
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}

/**
 * Masks a VIN to the first 11 characters followed by one dot per hidden character.
 * "2HGFC2F53KH123456" -> "2HGFC2F53KH••••••"
 */
export function maskVin(vin: string, visible = 11): string {
  const shown = vin.slice(0, visible);
  return shown + '•'.repeat(Math.max(0, vin.length - visible));
}

/**
 * Masks a VIN down to its last four characters, prefixed with four dots.
 * "2HGFC2F53KH124821" -> "••••4821"
 */
export function maskVinTail(vin: string, visible = 4): string {
  return '•'.repeat(4) + vin.slice(-visible);
}

/** "2019 Honda Civic EX" from a vehicle-ish shape. */
export function vehicleName(v: { year: number; make: string; model: string; trim?: string }): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
}

/** Today as an ISO date string (no time component). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIso(iso: string): Date {
  // Append a time so the string is parsed in local time rather than UTC,
  // which would shift dates backwards for negative-offset timezones.
  return new Date(`${iso}T12:00:00`);
}
