import { NotificationsList } from "@/components/NotificationsList";
import { notificationRoute } from "@/lib/notificationRoute";
import type { NotificationRouteData } from "@/lib/notificationRoute";

/**
 * Bandeja de avisos del admin. Vive en el stack raíz (como alerts/cartillas) y
 * no dentro de un tab: el tab bar del admin ya está lleno, y así se puede abrir
 * desde cualquier pestaña y desde el deep link de un push.
 */
export default function AdminNotificationsScreen() {
  return (
    <NotificationsList
      resolveRoute={(n) =>
        notificationRoute(n.type, n.data as NotificationRouteData, "ADMIN")
      }
    />
  );
}
