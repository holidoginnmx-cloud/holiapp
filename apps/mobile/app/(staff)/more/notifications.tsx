import { NotificationsList } from "@/components/NotificationsList";
import { notificationRoute } from "@/lib/notificationRoute";
import type { NotificationRouteData } from "@/lib/notificationRoute";

export default function StaffNotificationsScreen() {
  return (
    <NotificationsList
      resolveRoute={(n) =>
        notificationRoute(n.type, n.data as NotificationRouteData, "STAFF")
      }
    />
  );
}
