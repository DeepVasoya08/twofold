import { STORAGE_SIZES } from '@twofold/types';

import { useStorageUsage } from '../app/storage';
import { usageLabel, usedFraction } from '../lib/storage-usage';

import './storage-meter.css';

/**
 * How much of the shared 1 GB is used, as a bar and a label: the main library's own photos,
 * or in the private space the account's total (see app/storage.tsx).
 */
export function StorageMeter({ compact = false }: { compact?: boolean }) {
  const { bytes, scope } = useStorageUsage();
  const fraction = usedFraction(bytes);
  const label = usageLabel(bytes, scope);
  return (
    <div className={`storage-meter${compact ? ' storage-meter--compact' : ''}`}>
      <div
        className={`storage-meter__bar${fraction >= 0.9 ? ' is-nearly-full' : ''}`}
        role="meter"
        aria-label="Storage"
        aria-valuemin={0}
        aria-valuemax={STORAGE_SIZES.accountQuota}
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
