/**
 * useWebshop.js — hooks React Query du module Webshop (catalogue + commandes).
 * Les tournées (onglet Tournées) ont leurs propres hooks : useWebshopTournees.js.
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { unwrapResult } from '@lib/serviceHelpers';
import { webshopKeys, webshopTourKeys } from '@/shared/hooks/cacheKeys';
import { webshopProductsService } from '@services/webshopProducts.service';
import { webshopOrdersService } from '@services/webshopOrders.service';
import { webshopProcessService } from '@services/webshopProcess.service';

export function useWebshopCatalog() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const productsQuery = useQuery({
    queryKey: webshopKeys.products(orgId),
    queryFn: () => unwrapResult(webshopProductsService.getProducts(orgId)),
    enabled: !!orgId,
  });
  const categoriesQuery = useQuery({
    queryKey: webshopKeys.categories(orgId),
    queryFn: () => unwrapResult(webshopProductsService.getCategories(orgId)),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: webshopKeys.products(orgId) });

  const createMutation = useMutation({
    mutationFn: (payload) => unwrapResult(webshopProductsService.createProduct(orgId, payload)),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, patch }) => unwrapResult(webshopProductsService.updateProduct(orgId, id, patch)),
    onSuccess: invalidate,
  });

  return {
    orgId,
    products: productsQuery.data ?? [],
    categories: categoriesQuery.data ?? [],
    isLoading: productsQuery.isLoading || categoriesQuery.isLoading,
    error: productsQuery.error || categoriesQuery.error,
    createProduct: createMutation.mutateAsync,
    updateProduct: updateMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}

export function useWebshopOrders() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();
  const key = webshopKeys.orders(orgId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => unwrapResult(webshopOrdersService.getOrders(orgId)),
    enabled: !!orgId,
  });

  // Un changement de statut / suppression recompte les tournées (trigger 20261013_3).
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: webshopTourKeys.all(orgId) });
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }) => unwrapResult(webshopOrdersService.updateOrder(orgId, id, patch)),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData(key);
      qc.setQueryData(key, (old) => (old ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => unwrapResult(webshopOrdersService.deleteOrder(id)),
    onSettled: invalidateAll,
  });

  // Changement de colonne : TOUJOURS par l'edge webshop-process (statut + envois tracés).
  // Résout avec `{ order, actions }` ; rejette sur refus (invalid_transition, forbidden…).
  const transitionMutation = useMutation({
    mutationFn: ({ id, to }) => unwrapResult(webshopProcessService.transition(id, to)),
    onMutate: async ({ id, to }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData(key);
      qc.setQueryData(key, (old) => (old ?? []).map((o) => (o.id === id ? { ...o, status: to } : o)));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: webshopKeys.actions(orgId) });
    },
  });

  return {
    orgId,
    orders: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    updateOrder: updateMutation.mutateAsync,
    deleteOrder: deleteMutation.mutateAsync,
    transitionOrder: transitionMutation.mutateAsync,
  };
}

/**
 * Journal des envois des commandes affichées + rejeu d'une action.
 * @param {string[]} orderIds
 */
export function useWebshopOrderActions(orderIds) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();
  const ids = useMemo(() => [...(orderIds ?? [])].sort(), [orderIds]);

  const query = useQuery({
    queryKey: webshopKeys.actions(orgId, ids),
    queryFn: () => unwrapResult(webshopProcessService.getActions(orgId, ids)),
    enabled: !!orgId && ids.length > 0,
  });

  const byOrder = useMemo(() => {
    const map = new Map();
    for (const a of query.data ?? []) {
      if (!map.has(a.order_id)) map.set(a.order_id, []);
      map.get(a.order_id).push(a);
    }
    return map;
  }, [query.data]);

  // Résout avec `{ action }` (ActionReport) ; rejette sur already_sent / template_missing…
  const retryMutation = useMutation({
    mutationFn: (actionId) => unwrapResult(webshopProcessService.retry(actionId)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: webshopKeys.actions(orgId) });
      qc.invalidateQueries({ queryKey: webshopKeys.orders(orgId) });
    },
  });

  return {
    actionsByOrder: byOrder,
    isLoading: query.isLoading,
    error: query.error,
    retryAction: retryMutation.mutateAsync,
    retryingId: retryMutation.isPending ? retryMutation.variables : null,
  };
}
