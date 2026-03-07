import { CLIENT_CATEGORIES } from '@/shared/services/clients.service';

export const ClientCategoryBadge = ({ clientCategory }) => {
  const found = CLIENT_CATEGORIES.find((t) => t.value === clientCategory);
  if (!found) return null;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${found.color}`}>
      {found.label}
    </span>
  );
};
