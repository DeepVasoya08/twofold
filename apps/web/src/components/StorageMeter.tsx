import { STORAGE_SIZES } from '@twofold/types';

import { useVault } from '../app/vault';
import { spaceBytes, usageLabel, usedFraction } from '../lib/storage-usage';

import './storage-meter.css';

/** How much of the 1 GB the open space's photos take up, as a bar and a label. */
export function StorageMeter({ compact = false }: { compact?: boolean }) {
  const { state } = useVault();
  const bytes = spaceBytes(state.photos);
  const fraction = usedFraction(bytes);
  const label = usageLabel(bytes);
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
