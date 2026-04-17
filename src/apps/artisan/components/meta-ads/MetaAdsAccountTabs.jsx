export function MetaAdsAccountTabs({ accounts, activeAccount, onChange }) {
  if (!accounts || accounts.length === 0) return null;

  return (
    <div className="border-b border-secondary-200">
      <nav className="flex gap-6 overflow-x-auto">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeAccount === null
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-secondary-500 hover:text-secondary-800'
          }`}
        >
          Tous les comptes
        </button>
        {accounts.map((acc) => (
          <button
            key={acc.ad_account_id}
            type="button"
            onClick={() => onChange(acc.ad_account_id)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeAccount === acc.ad_account_id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-secondary-500 hover:text-secondary-800'
            }`}
          >
            {acc.ad_account_name}
          </button>
        ))}
      </nav>
    </div>
  );
}
