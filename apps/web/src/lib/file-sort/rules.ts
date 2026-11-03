import type { Category } from './categories';
import { wordsIn } from './words';

/**
 * Sorting by words: each category has a short list of words and phrases that give it away,
 * each with a weight. Mostly English, with Indian, UK and US forms where they differ. Works
 * offline and instantly, and its reasons are easy to follow.
 */
type Signals = Record<string, number>;

const SIGNALS: Record<Exclude<Category, 'other'>, Signals> = {
  receipts: {
    invoice: 3,
    'tax invoice': 3,
    receipt: 3,
    'total due': 3,
    'amount due': 3,
    'amount paid': 2,
    subtotal: 3,
    'sub total': 3,
    'unit price': 2,
    qty: 2,
    'order number': 2,
    'order id': 2,
    bill: 2,
    billing: 2,
    gst: 2,
    gstin: 2,
    vat: 2,
    'payment received': 2,
    'thank you for your purchase': 3,
    'thank you for your order': 3,
    purchase: 1,
    paid: 1,
  },
  finance: {
    'bank statement': 4,
    'account statement': 3,
    statement: 2,
    'account number': 2,
    ifsc: 3,
    iban: 3,
    'sort code': 3,
    'opening balance': 3,
    'closing balance': 3,
    balance: 1,
    'credit card': 2,
    loan: 2,
    emi: 2,
    mortgage: 3,
    'mutual fund': 3,
    portfolio: 2,
    dividend: 2,
    'interest rate': 2,
    withdrawal: 2,
    deposit: 1,
    transactions: 1,
    bank: 1,
  },
  tax: {
    'income tax': 4,
    'tax return': 4,
    itr: 3,
    'form 16': 4,
    'form 26as': 4,
    'w 2': 3,
    '1099': 3,
    irs: 3,
    hmrc: 3,
    'self assessment': 3,
    'assessment year': 3,
    'tax deducted': 3,
    tds: 3,
    'tax refund': 3,
    'taxable income': 3,
  },
  ids: {
    passport: 4,
    visa: 3,
    'driving licence': 4,
    'driving license': 4,
    "driver's license": 4,
    aadhaar: 4,
    'pan card': 4,
    'voter id': 4,
    'identity card': 3,
    'id card': 3,
    'residence permit': 4,
    'birth certificate': 4,
    'date of birth': 2,
    nationality: 2,
    'boarding pass': 4,
    itinerary: 3,
    'e ticket': 3,
    eticket: 3,
    pnr: 3,
    'booking reference': 3,
    'booking confirmation': 3,
    flight: 2,
    hotel: 1,
  },
  medical: {
    prescription: 4,
    'discharge summary': 4,
    diagnosis: 3,
    patient: 3,
    hospital: 3,
    'lab report': 3,
    'blood test': 3,
    haemoglobin: 3,
    hemoglobin: 3,
    pathology: 3,
    radiology: 3,
    vaccination: 3,
    'health insurance': 3,
    clinic: 2,
    doctor: 2,
    dosage: 2,
    symptoms: 2,
    vaccine: 2,
    medical: 2,
    mri: 2,
    'x ray': 2,
    tablets: 1,
  },
  work: {
    'offer letter': 4,
    payslip: 4,
    'pay slip': 4,
    'salary slip': 4,
    'curriculum vitae': 4,
    'appointment letter': 3,
    agreement: 3,
    contract: 3,
    employment: 3,
    resume: 3,
    'non disclosure': 3,
    nda: 3,
    'statement of work': 3,
    lease: 3,
    salary: 2,
    employer: 2,
    employee: 2,
    landlord: 2,
    tenant: 2,
    proposal: 2,
    'terms and conditions': 2,
    cv: 2,
    hereby: 1,
    signature: 1,
  },
  school: {
    marksheet: 4,
    'mark sheet': 4,
    'report card': 4,
    school: 3,
    university: 3,
    college: 3,
    semester: 3,
    transcript: 3,
    gpa: 3,
    cgpa: 3,
    homework: 3,
    syllabus: 3,
    diploma: 3,
    'student id': 3,
    'roll number': 3,
    assignment: 2,
    exam: 2,
    examination: 2,
    admission: 2,
    lecture: 2,
    degree: 2,
    enrollment: 2,
    enrolment: 2,
  },
  notes: {
    'shopping list': 3,
    'packing list': 3,
    'to do': 2,
    todo: 2,
    recipe: 3,
    checklist: 2,
    notes: 2,
    journal: 2,
    diary: 2,
    note: 1,
    list: 1,
  },
};

/** Lowest score that sorts a file, and how far ahead of the next category it must be. */
const SURE_SCORE = 3;
const SURE_MARGIN = 2;

/** Words as one spaced string, so phrases match on whole words only. */
function spaced(text: string): string {
  return ` ${wordsIn(text).join(' ')} `;
}

function count(haystack: string, needle: string): number {
  let found = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    found += 1;
  }
  return found;
}

/** Each category's score for a file's name and text. Words in the name count double. */
export function scoreByWords(name: string, text: string): Map<Category, number> {
  const inName = spaced(name.replace(/\.[^.]*$/, ''));
  const inText = spaced(text);
  const scores = new Map<Category, number>();
  for (const [category, signals] of Object.entries(SIGNALS) as [Category, Signals][]) {
    let score = 0;
    for (const [phrase, weight] of Object.entries(signals)) {
      const needle = spaced(phrase);
      if (inName.includes(needle)) score += weight * 2;
      const times = count(inText, needle);
      // A word said often counts a little more, but never runs away with it.
      if (times > 0) score += weight + (times >= 3 ? 1 : 0);
    }
    if (score > 0) scores.set(category, score);
  }
  return scores;
}

/** The category the words point to, or null when no category is clearly ahead. */
export function sortByWords(name: string, text: string): Category | null {
  const ranked = [...scoreByWords(name, text)].sort((a, b) => b[1] - a[1]);
  const [best, next] = ranked;
  if (!best || best[1] < SURE_SCORE) return null;
  if (next && best[1] - next[1] < SURE_MARGIN) return null;
  return best[0];
}
