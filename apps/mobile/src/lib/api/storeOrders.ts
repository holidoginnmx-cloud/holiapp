import { apiFetch } from "./client";

// ─── Pedidos de la tienda en línea (solo ADMIN) ─────────────
// packages/api/src/routes/adminStoreOrders.ts

export type StoreFulfillment = "PICKUP" | "LOCAL_DELIVERY" | "NATIONAL_SHIPPING";

export type StoreOrder = {
  id: string;
  orderNumber: number;
  status: "PENDING" | "PAID" | "FULFILLED" | "CANCELLED" | "REFUNDED";
  fulfillmentType: StoreFulfillment;
  /** Pagado y sin despachar: es lo que dispara el recordatorio diario. */
  pending: boolean;
  total: number;
  subtotal: number;
  shippingTotal: number;
  discountTotal: number;
  paidAt: string | null;
  createdAt: string;
  email: string | null;
  customerName: string | null;
  /** Sugerencia (perfil o dirección); el equipo la puede corregir. */
  customerPhone: string | null;
  shippingAddress: string | null;
  notes: string | null;
  items: { name: string; variant: string | null; quantity: number; lineTotal: number }[];
  trackingCarrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** Mensaje para el cliente, listo para WhatsApp. null mientras no hay guía. */
  shipmentMessage: string | null;
};

export const getAdminStoreOrders = () =>
  apiFetch<{ carriers: string[]; pending: StoreOrder[]; recent: StoreOrder[] }>(
    "/admin/store/orders",
  );

export const getAdminStoreOrder = (id: string) =>
  apiFetch<{ carriers: string[]; order: StoreOrder }>(`/admin/store/orders/${id}`);

export const saveStoreOrderShipment = (
  id: string,
  body: { carrier: string; trackingNumber: string },
) =>
  apiFetch<{ order: StoreOrder; emailSentTo: string | null; emailSkipped: boolean }>(
    `/admin/store/orders/${id}/shipment`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const markStoreOrderDelivered = (id: string) =>
  apiFetch<{ order: StoreOrder }>(`/admin/store/orders/${id}/delivered`, {
    method: "POST",
    body: JSON.stringify({}),
  });
