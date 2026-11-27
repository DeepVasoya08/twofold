import { useStorageLimit, useStorageUsage } from '../app/storage';
import { usageLabel, usedFraction } from '../lib/storage-usage';

import './storage-meter.css';

/** How much of the account's limit is used, across both spaces, as a bar and a label. */
export function StorageMeter({ compact = false }: { compact?: boolean }) {
  const bytes = useStorageUsage();
  const limit = useStorageLimit();
  const fraction = usedFraction(bytes, limit);
  const label = usageLabel(bytes, limit);
  return (
    <div className={`storage-meter${compact ? ' storage-meter--compact' : ''}`}>
      <div
        className={`storage-meter__bar${fraction >= 0.9 ? ' is-nearly-full' : ''}`}
        role="meter"
        aria-label="Storage"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={bytes}
        aria-valuetext={label}
      >
        <span
          className="storage-meter__fill"
          style={{ width: `${String(Math.round(fraction * 1000) / 10)}%` }}
        />
      </div>
      <span className="storage-meter__label">{label}</span>
    </div>
  );
}
