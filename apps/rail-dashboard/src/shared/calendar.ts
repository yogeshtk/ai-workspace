// England & Wales bank holidays (source: gov.uk/bank-holidays). Used to warn
// that a reduced/Sunday-style timetable may apply and to honour the CIF
// "does not run on bank holidays" flag. Extend this list each year, or set
// BANK_HOLIDAYS=YYYY-MM-DD,... on the server to add more.
const ENGLAND_WALES_BANK_HOLIDAYS = new Set<string>([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
]);

const extra = new Set<string>();

export function addBankHolidays(dates: string[]): void {
  for (const d of dates) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) extra.add(d);
}

export function isBankHoliday(date: string): boolean {
  return ENGLAND_WALES_BANK_HOLIDAYS.has(date) || extra.has(date);
}

/** Christmas Day and Boxing Day: normally no National Rail services at all. */
export function isNoServiceDay(date: string): boolean {
  return date.endsWith('-12-25') || date.endsWith('-12-26');
}
