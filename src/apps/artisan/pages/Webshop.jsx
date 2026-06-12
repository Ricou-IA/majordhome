/**
 * Webshop.jsx - Majord'home Artisan
 * ============================================================================
 * Module Webshop : suivi des commandes du site web (format drop shipping)
 * + édition des tarifs produits affichés sur le site.
 *
 * - Onglet « Commandes » : kanban-léger par statut (nouvelle → confirmée →
 *   transmise fournisseur → expédiée → livrée / annulée), édition transporteur
 *   + n° de suivi, notes internes. Les ventes + installation sont liées à un
 *   lead pipeline (lead_id).
 * - Onglet « Produits & tarifs » : prix TTC vente directe / posé particulier /
 *   posé pro, lus en direct par le site web (mayer-energie.fr).
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShoppingCart,
  RefreshCw,
  Loader2,
  Package,
  Truck,
  Save,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  MapPin,
  Building2,
  Euro,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  webshopService,
  WEBSHOP_ORDER_STATUSES,
  WEBSHOP_CHANNELS,
  WEBSHOP_ORDER_TYPES,
  getStatusMeta,
} from '@services/webshop.service';

// ============================================================================
// HELPERS
// ============================================================================

const euros = (n) =>
  Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) +
  ' €';

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

function MetaBadge({ list, value }) {
  const meta = list.find((m) => m.value === value);
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

// ============================================================================
// ONGLET COMMANDES
// ============================================================================

function OrderRow({ order, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [carrier, setCarrier] = useState(order.carrier || '');
  const [tracking, setTracking] = useState(order.tracking_number || '');
  const [notes, setNotes] = useState(order.internal_notes || '');

  const statusMeta = getStatusMeta(order.status);

  const handleStatusChange = async (newStatus) => {
    setSaving(true);
    const { error } = await webshopService.updateOrder(order.id, { status: newStatus });
    setSaving(false);
    if (error) {
      toast.error('Erreur lors du changement de statut');
      return;
    }
    toast.success(`Commande ${order.order_number} → ${getStatusMeta(newStatus).label}`);
    onUpdate();
  };

  const handleSaveShipping = async () => {
    setSaving(true);
    const { error } = await webshopService.updateOrder(order.id, {
      carrier: carrier || null,
      tracking_number: tracking || null,
      internal_notes: notes || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Erreur lors de l'enregistrement");
      return;
    }
    toast.success('Suivi enregistré');
    onUpdate();
  };

  return (
    <div className="bg-white border border-secondary-200 rounded-xl overflow-hidden">
      {/* Ligne principale */}
      <div
        className="grid grid-cols-12 gap-2 items-center px-4 py-3 cursor-pointer hover:bg-secondary-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="col-span-2">
          <p className="font-semibold text-sm text-secondary-900">{order.order_number}</p>
          <p className="text-xs text-secondary-500">{formatDate(order.created_at)}</p>
        </div>
        <div className="col-span-3">
          <p className="text-sm font-medium text-secondary-900">
            {order.first_name} {order.last_name}
          </p>
          <p className="text-xs text-secondary-500">
            {order.postal_code} {order.city}
            {order.channel === 'pro' && order.company_name ? ` — via ${order.company_name}` : ''}
          </p>
        </div>
        <div className="col-span-3">
          <p className="text-sm text-secondary-700">
            {order.product_name || order.product_slug} × {order.quantity}
          </p>
          <div className="flex gap-1 mt-0.5 flex-wrap">
            <MetaBadge list={WEBSHOP_CHANNELS} value={order.channel} />
            <MetaBadge list={WEBSHOP_ORDER_TYPES} value={order.order_type} />
          </div>
        </div>
        <div className="col-span-1 text-right">
          <p className="text-sm font-bold text-secondary-900">{euros(order.total_ttc)}</p>
        </div>
        <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
          <select
            value={order.status}
            disabled={saving}
            onChange={(e) => handleStatusChange(e.target.value)}
            className={`w-full text-xs font-medium rounded-lg border px-2 py-1.5 cursor-pointer ${statusMeta.color}`}
          >
            {WEBSHOP_ORDER_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-1 flex justify-end items-center gap-1">
          {order.tracking_number && <Truck className="w-4 h-4 text-purple-500" title="N° de suivi renseigné" />}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-secondary-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-secondary-400" />
          )}
        </div>
      </div>

      {/* Détail */}
      {expanded && (
        <div className="border-t border-secondary-100 bg-secondary-50/50 px-4 py-4 grid md:grid-cols-3 gap-4">
          {/* Contact */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400">
              {order.order_type === 'vente_installation' ? 'Client final / adresse de pose' : 'Client / adresse de livraison'}
            </p>
            <p className="text-sm font-medium text-secondary-900">
              {order.first_name} {order.last_name}
            </p>
            <p className="text-sm text-secondary-600 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> {order.address}, {order.postal_code} {order.city}
            </p>
            <p className="text-sm text-secondary-600 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              <a href={`tel:${order.phone}`} className="hover:text-primary-600">{order.phone}</a>
            </p>
            {order.email && (
              <p className="text-sm text-secondary-600 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                <a href={`mailto:${order.email}`} className="hover:text-primary-600">{order.email}</a>
              </p>
            )}
            {order.channel === 'pro' && (
              <div className="mt-2 pt-2 border-t border-secondary-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400 mb-1">
                  Concessionnaire (apporteur)
                </p>
                <p className="text-sm text-secondary-700 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> {order.company_name}
                  {order.company_siret ? ` — SIRET ${order.company_siret}` : ''}
                </p>
                <p className="text-xs text-secondary-500">
                  {order.company_contact} · {order.company_phone} · {order.company_email}
                </p>
              </div>
            )}
            {order.comments && (
              <p className="text-xs text-secondary-500 italic mt-2">« {order.comments} »</p>
            )}
            {order.lead_id && (
              <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                Lead pipeline lié ({order.lead_name || 'voir Pipeline'})
              </p>
            )}
          </div>

          {/* Montants */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400">Montants</p>
            <p className="text-sm text-secondary-600">
              {order.quantity} × {euros(order.unit_price_ttc)} ={' '}
              <span className="font-bold text-secondary-900">{euros(order.total_ttc)} TTC</span>
            </p>
            <p className="text-xs text-secondary-500">
              Expédiée : {formatDate(order.shipped_at)} · Livrée : {formatDate(order.delivered_at)}
            </p>
          </div>

          {/* Expédition / notes */}
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400">
              Expédition (drop shipping)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Transporteur"
                className="text-sm border border-secondary-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <input
                type="text"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="N° de suivi"
                className="text-sm border border-secondary-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes internes (fournisseur contacté, particularités…)"
              rows={2}
              className="w-full text-sm border border-secondary-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={handleSaveShipping}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Enregistrer le suivi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');

  const load = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await webshopService.getOrders();
    setIsLoading(false);
    if (error) {
      toast.error('Erreur de chargement des commandes');
      return;
    }
    setOrders(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { all: orders.length };
    for (const s of WEBSHOP_ORDER_STATUSES) {
      c[s.value] = orders.filter((o) => o.status === s.value).length;
    }
    return c;
  }, [orders]);

  const filtered = useMemo(
    () =>
      orders
        .filter((o) => statusFilter === 'all' || o.status === statusFilter)
        .filter((o) => channelFilter === 'all' || o.channel === channelFilter),
    [orders, statusFilter, channelFilter]
  );

  return (
    <div className="space-y-4">
      {/* Filtres statuts */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            statusFilter === 'all'
              ? 'bg-secondary-900 text-white border-secondary-900'
              : 'bg-white text-secondary-600 border-secondary-200 hover:border-secondary-400'
          }`}
        >
          Toutes ({counts.all})
        </button>
        {WEBSHOP_ORDER_STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === s.value ? s.color + ' ring-2 ring-offset-1 ring-secondary-300' : 'bg-white text-secondary-600 border-secondary-200 hover:border-secondary-400'
            }`}
          >
            {s.label} ({counts[s.value]})
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="text-xs border border-secondary-200 rounded-lg px-2.5 py-1.5 bg-white"
          >
            <option value="all">Tous les canaux</option>
            <option value="particulier">Particuliers</option>
            <option value="pro">Pros / concessionnaires</option>
          </select>
          <button
            onClick={load}
            className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 text-primary-600 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-secondary-200 rounded-xl">
          <ShoppingCart className="w-10 h-10 text-secondary-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-600">Aucune commande</p>
          <p className="text-xs text-secondary-400 mt-1">
            Les commandes passées sur mayer-energie.fr apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((order) => (
            <OrderRow key={order.id} order={order} onUpdate={load} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ONGLET PRODUITS & TARIFS
// ============================================================================

function ProductRow({ product, onUpdate }) {
  const [saving, setSaving] = useState(false);
  const [price, setPrice] = useState(product.price_ttc ?? '');
  const [installPrice, setInstallPrice] = useState(product.install_price_ttc ?? '');
  const [proPrice, setProPrice] = useState(product.pro_install_price_ttc ?? '');
  const [active, setActive] = useState(product.is_active);

  const dirty =
    Number(price) !== Number(product.price_ttc) ||
    Number(installPrice || 0) !== Number(product.install_price_ttc || 0) ||
    Number(proPrice || 0) !== Number(product.pro_install_price_ttc || 0) ||
    active !== product.is_active;

  const handleSave = async () => {
    if (!price || Number(price) <= 0) {
      toast.error('Le prix de vente directe est requis');
      return;
    }
    setSaving(true);
    const { error } = await webshopService.updateProduct(product.id, {
      price_ttc: Number(price),
      install_price_ttc: installPrice ? Number(installPrice) : null,
      pro_install_price_ttc: proPrice ? Number(proPrice) : null,
      is_active: active,
    });
    setSaving(false);
    if (error) {
      toast.error("Erreur lors de l'enregistrement du produit");
      return;
    }
    toast.success(`Tarifs « ${product.name} » mis à jour — le site affiche les nouveaux prix immédiatement`);
    onUpdate();
  };

  const priceInput = (value, setter, label) => (
    <div>
      <label className="block text-xs text-secondary-500 mb-1">{label}</label>
      <div className="relative">
        <input
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(e) => setter(e.target.value)}
          className="w-full text-sm border border-secondary-200 rounded-lg pl-2.5 pr-7 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <Euro className="w-3.5 h-3.5 text-secondary-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
      </div>
    </div>
  );

  return (
    <div className={`bg-white border rounded-xl p-5 ${active ? 'border-secondary-200' : 'border-dashed border-secondary-300 opacity-70'}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h3 className="font-semibold text-secondary-900">{product.name}</h3>
            <p className="text-xs text-secondary-500">
              {product.brand} {product.model} · slug : {product.slug}
            </p>
            {product.short_description && (
              <p className="text-xs text-secondary-500 mt-1 max-w-xl">{product.short_description}</p>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-secondary-600 cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500"
          />
          Visible sur le site
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        {priceInput(price, setPrice, 'Vente directe TTC (livrée)')}
        {priceInput(installPrice, setInstallPrice, 'Posée TTC (particulier)')}
        {priceInput(proPrice, setProPrice, 'Posée TTC (pro / bon de commande)')}
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40 rounded-lg transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Enregistrer
        </button>
      </div>
      <p className="text-[11px] text-secondary-400 mt-2">
        TVA vente : {Number(product.vat_rate)} % · TVA pose : {Number(product.install_vat_rate ?? 0)} % — les prix saisis sont TTC et affichés tels quels sur le site.
      </p>
    </div>
  );
}

function ProductsTab() {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await webshopService.getProducts();
    setIsLoading(false);
    if (error) {
      toast.error('Erreur de chargement des produits');
      return;
    }
    setProducts(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-7 h-7 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {products.map((p) => (
        <ProductRow key={p.id} product={p} onUpdate={load} />
      ))}
      {products.length === 0 && (
        <div className="text-center py-16 bg-white border border-dashed border-secondary-200 rounded-xl">
          <Package className="w-10 h-10 text-secondary-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-600">Aucun produit au catalogue</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PAGE
// ============================================================================

export default function Webshop() {
  const [tab, setTab] = useState('orders');

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary-100 rounded-xl flex items-center justify-center">
            <ShoppingCart className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-secondary-900">Webshop</h1>
            <p className="text-sm text-secondary-500">
              Commandes du site web (drop shipping) et tarifs affichés en ligne
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-secondary-200">
        <button
          onClick={() => setTab('orders')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'orders'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-secondary-500 hover:text-secondary-700'
          }`}
        >
          Commandes
        </button>
        <button
          onClick={() => setTab('products')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'products'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-secondary-500 hover:text-secondary-700'
          }`}
        >
          Produits &amp; tarifs
        </button>
      </div>

      {tab === 'orders' ? <OrdersTab /> : <ProductsTab />}
    </div>
  );
}
