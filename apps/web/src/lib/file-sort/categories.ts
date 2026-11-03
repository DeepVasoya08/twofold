/**
 * The fixed categories files are sorted into. The ids are stored in each file's sealed
 * metadata, so they never change; the labels can.
 */
export const CATEGORIES = [
  'receipts',
  'finance',
  'tax',
  'ids',
  'medical',
  'work',
  'school',
  'notes',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

const LABELS: Record<Category, string> = {
  receipts: 'Receipts and invoices',
  finance: 'Bank and finance',
  tax: 'Tax',
  ids: 'IDs and travel',
  medical: 'Medical',
  work: 'Work and contracts',
  school: 'School',
  notes: 'Notes',
  other: 'Other',
};

export function categoryLabel(category: Category): string {
  return LABELS[category];
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}
