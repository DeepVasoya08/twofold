import type { ReactNode } from 'react';

import { Icon } from './Icon';
import type { IconName } from './Icon';

import './empty-state.css';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={28} />
      </span>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__text">{children}</p>
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}
