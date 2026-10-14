/** OrdersTab — kanban des commandes boutique (5 colonnes glissables + 2 repliées). */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { KanbanBoard } from '@apps/artisan/components/shared/KanbanBoard';
import { useWebshopOrders } from '@hooks/useWebshop';
import { selectClass } from '@apps/artisan/components/FormFields';
import {
  ORDER_BOARD_COLUMNS, ORDER_SIDE_STATUSES, ORDER_STATUS_LABELS, canMoveTo, statusPatch,
  matchesOrderSearch, orderTotalCents,
} from '@/lib/webshop/orders';
import OrderCard from './OrderCard';
import OrderDrawer from './OrderDrawer';
import SideColumn from './SideColumn';

export default function OrdersTab() {
  const { orders, isLoading, error, refetch, updateOrder, deleteOrder } = useWebshopOrders();
  const [channel, setChannel] = useState('');
  const [orderType, setOrderType] = useState('');
  const [openId, setOpenId] = useState(null);

  const visible = useMemo(
    () => orders.filter((o) => (!channel || o.channel === channel) && (!orderType || o.order_type === orderType)),
    [orders, channel, orderType],
  );
  const boardOrders = useMemo(() => visible.filter((o) => !ORDER_SIDE_STATUSES.includes(o.status)), [visible]);
  const openOrder = orders.find((o) => o.id === openId) ?? null;

  const handleDragEnd = async (result) => {
    const order = orders.find((o) => o.id === result.draggableId);
    const to = result.destination?.droppableId;
    if (!order || !canMoveTo(order.status, to)) return;
    try {
      await updateOrder({ id: order.id, patch: statusPatch(order, to) });
      toast.success(`${order.order_number} → ${ORDER_STATUS_LABELS[to]}`);
    } catch (err) {
      toast.error(`Changement refusé : ${err.message}`);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-secondary-400" /></div>;
  if (error) return <div className="text-center py-12 text-red-600 text-sm">Chargement des commandes impossible : {error.message}</div>;

  return (
    <div className="space-y-4">
      <KanbanBoard
        items={boardOrders}
        columns={ORDER_BOARD_COLUMNS}
        groupBy="status"
        renderCard={(o) => <OrderCard order={o} />}
        onCardClick={(o) => setOpenId(o.id)}
        onDragEnd={handleDragEnd}
        searchFilter={matchesOrderSearch}
        searchPlaceholder="N°, client, ville, email"
        columnAmount={(items) => items.reduce((s, o) => s + orderTotalCents(o), 0) / 100}
        emptyMessage="Aucune commande"
        headerLeft={(
          <div className="flex items-center gap-2">
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${selectClass} w-44 py-1.5`}>
              <option value="">Tous les canaux</option>
              <option value="particulier">Particulier</option>
              <option value="pro">Pro / concessionnaire</option>
            </select>
            <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className={`${selectClass} w-48 py-1.5`}>
              <option value="">Tous les types</option>
              <option value="vente_directe">Vente directe</option>
              <option value="vente_installation">Vente + installation</option>
            </select>
          </div>
        )}
        headerRight={(
          <button type="button" onClick={() => refetch()} className="p-2 text-secondary-400 hover:text-secondary-700" title="Actualiser">
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      />
      {ORDER_SIDE_STATUSES.map((s) => (
        <SideColumn key={s} status={s} orders={visible.filter((o) => o.status === s)} onOpen={(o) => setOpenId(o.id)} />
      ))}
      {openOrder && (
        <OrderDrawer
          key={openOrder.id}
          order={openOrder}
          onClose={() => setOpenId(null)}
          updateOrder={updateOrder}
          deleteOrder={deleteOrder}
        />
      )}
    </div>
  );
}
