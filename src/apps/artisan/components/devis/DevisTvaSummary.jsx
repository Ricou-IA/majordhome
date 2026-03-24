/**
 * DevisTvaSummary.jsx — Tableau ventilation TVA + totaux
 */

import { formatEuro } from '@/lib/utils';

export default function DevisTvaSummary({ totals, globalDiscountPercent = 0 }) {
  if (!totals) return null;

  return (
    <div className="bg-secondary-50 rounded-lg p-4 space-y-2">
      {/* Sous-total avant remise */}
      <div className="flex justify-between text-sm text-secondary-600">
        <span>Sous-total HT</span>
        <span>{formatEuro(totals.subtotal_ht)}</span>
      </div>

      {/* Remise */}
      {globalDiscountPercent > 0 && (
        <div className="flex justify-between text-sm text-red-600">
          <span>Remise ({globalDiscountPercent}%)</span>
          <span>-{formatEuro(totals.discount_amount)}</span>
        </div>
      )}

      {/* Total HT après remise */}
      <div className="flex justify-between text-sm font-medium text-secondary-800 border-t border-secondary-200 pt-2">
        <span>Total HT</span>
        <span>{formatEuro(totals.total_ht)}</span>
      </div>

      {/* Ventilation TVA */}
      {totals.tva_breakdown?.map((t) => (
        <div key={t.rate} className="flex justify-between text-sm text-secondary-500">
          <span>TVA {t.rate}% (base : {formatEuro(t.base_ht)})</span>
          <span>{formatEuro(t.tva_amount)}</span>
        </div>
      ))}

      {/* Total TTC */}
      <div className="flex justify-between text-base font-bold text-secondary-900 border-t border-secondary-300 pt-2">
        <span>Total TTC</span>
        <span>{formatEuro(totals.total_ttc)}</span>
      </div>
    </div>
  );
}
