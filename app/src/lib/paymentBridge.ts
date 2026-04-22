// Payment Bridge V1 — URL generators and reference builder.
// All generators return null if required input is missing, so callers
// can show an inline "Add <provider> handle" CTA instead of a broken URL.

export function monzoUrl(handle: string, amount: string): string | null {
  if (!handle) return null;
  return `https://monzo.me/${encodeURIComponent(handle)}/${amount}`;
}

export function revolutUrl(handle: string, amount: string): string | null {
  if (!handle) return null;
  return `https://revolut.me/${encodeURIComponent(handle)}/${amount}`;
}

export type PayPalCurrency = 'GBP' | 'USD' | 'EUR';

export function paypalUrl(
  handle: string,
  amount: string,
  currency: PayPalCurrency,
): string | null {
  if (!handle) return null;
  return `https://paypal.me/${encodeURIComponent(handle)}/${amount}${currency}`;
}

export function venmoUrl(handle: string, amount: string, note: string): string {
  const params = new URLSearchParams({
    txn: 'pay',
    recipients: handle,
    amount,
    note,
  });
  return `venmo://paycharge?${params.toString()}`;
}

// "MC <FirstName> <DDMMM>" — max 18 chars, alphanumeric + spaces only.
// UK Faster Payments references allow 18 chars; some banks strip specials.
export function buildReference(
  childFirstName: string,
  date: Date = new Date(),
): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const mmm = months[date.getUTCMonth()];
  const cleanName = childFirstName.replace(/[^A-Za-z0-9]/g, '');
  const fixedSuffix = ` ${dd}${mmm}`;   // e.g. " 22APR" — 6 chars
  const prefix = 'MC ';                 // 3 chars
  const nameBudget = 18 - prefix.length - fixedSuffix.length; // 9
  return `${prefix}${cleanName.slice(0, nameBudget)}${fixedSuffix}`;
}
