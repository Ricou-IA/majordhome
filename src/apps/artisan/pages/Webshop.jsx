/**
 * Webshop.jsx - Majord'home Artisan
 * ============================================================================
 * Module Webshop (boutique du site Mayer) : orchestrateur d'onglets.
 * - Commandes : kanban (components/webshop/orders)
 * - Produits & tarifs : éditeur du catalogue lu en direct par le site (components/webshop/products)
 * - Tournées : livraisons palettes (components/webshop/tournees)
 * - Inscriptions : inscriptions aux offres
 * Spec : docs/superpowers/specs/2026-10-13-webshop-editeur-catalogue-kanban-commandes-design.md
 * ============================================================================
 */
import { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import OrdersTab from '@/apps/artisan/components/webshop/orders/OrdersTab';
import ProductsTab from '@/apps/artisan/components/webshop/products/ProductsTab';
import TourneesTab from '@/apps/artisan/components/webshop/tournees/TourneesTab';
import InscriptionsTab from '@/apps/artisan/components/webshop/InscriptionsTab';

const TABS = [
  { id: 'orders', label: 'Commandes', Component: OrdersTab },
  { id: 'products', label: 'Produits & tarifs', Component: ProductsTab },
  { id: 'tournees', label: 'Tournées', Component: TourneesTab },
  { id: 'inscriptions', label: 'Inscriptions', Component: InscriptionsTab },
];

export default function Webshop() {
  const [tab, setTab] = useState('orders');
  const Active = TABS.find((t) => t.id === tab).Component;

  return (
    <div className={`p-6 mx-auto ${tab === 'orders' ? 'max-w-[1400px]' : 'max-w-6xl'}`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 bg-primary-100 rounded-xl flex items-center justify-center">
          <ShoppingCart className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-secondary-900">Webshop</h1>
          <p className="text-sm text-secondary-500">Commandes et catalogue de la boutique en ligne</p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b border-secondary-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-secondary-500 hover:text-secondary-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Active />
    </div>
  );
}
