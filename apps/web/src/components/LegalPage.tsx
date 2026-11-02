import type { ReactNode } from 'react';

import { isDraft, legalDetails } from '../legal/details';
import type { LegalDetails } from '../legal/details';
import { SiteFooter, SiteHeader } from './SiteChrome';

import './legal-page.css';

/** A value from legal/details.ts, or a highlighted placeholder while it's missing. */
export function Fill({ field, label }: { field: keyof LegalDetails; label: string }) {
  const value = legalDetails[field];
  return value === null ? <mark className="legal__fill">[{label}]</mark> : <>{value}</>;
}

/** The layout of the Privacy Policy and Terms of Use. */
export function LegalPage({
  title,
  summary,
  uses,
  children,
}: {
  title: string;
  summary: ReactNode;
  /** The details this page shows: it is a draft only while one of them is missing. */
  uses: readonly (keyof LegalDetails)[];
  children: ReactNode;
}) {
  return (
    <div className="legal">
      <SiteHeader />
      <main className="legal__main">
        <header className="legal__header">
          <h1 className="legal__title">{title}</h1>
          <p className="legal__date">
            Effective <Fill field="effectiveDate" label="effective date" />
          </p>
          {isDraft(legalDetails, ['effectiveDate', ...uses]) && (
            <p className="legal__draft" role="note">
              Draft. Highlighted details are still to be filled in, and this page is waiting on a
              legal review.
            </p>
          )}
          <div className="legal__summary">{summary}</div>
        </header>
        <article className="legal__body">{children}</article>
      </main>
      <SiteFooter />
    </div>
  );
}
