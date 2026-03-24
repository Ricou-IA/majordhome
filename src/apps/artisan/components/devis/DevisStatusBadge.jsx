import { QUOTE_STATUSES } from '@services/devis.service';

export default function DevisStatusBadge({ status }) {
  const config = QUOTE_STATUSES.find((s) => s.value === status) || QUOTE_STATUSES[0];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${config.color}`}>
      {config.label}
    </span>
  );
}
