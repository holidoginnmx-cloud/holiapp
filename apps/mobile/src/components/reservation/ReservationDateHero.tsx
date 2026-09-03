import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import type { ReservationDetail } from "@/lib/api";
import {
  formatDayShort,
  formatTime,
  formatTimeHHmm,
  formatWeekdayDayShort,
  formatWeekdayShort,
} from "@/lib/format";
import { styles } from "@/styles/ownerReservationDetailStyles";

type ReservationDateHeroProps = {
  reservation: ReservationDetail;
  /** ¿La reserva es multi-mascota? Oculta la raza del meta-row. */
  hasGroup: boolean;
  /** La hora de llegada solo se edita mientras no haya check-in. */
  canEditCheckInTime: boolean;
  /** La de recogida, hasta el check-out. */
  canEditCheckOutTime: boolean;
  /** Abre el selector de hora estimada. */
  onPickTime: (which: "in" | "out") => void;
};

/**
 * Encabezado de fechas del detalle de una reservación, en sus tres formas:
 *
 * - DAYCARE / BATH: badge del servicio + día y hora de la cita.
 * - STAY: los dos pills de check-in/check-out unidos por el contador de
 *   noches, cada uno con su chip de hora estimada (editable según el estado),
 *   más la fila de habitación y raza.
 *
 * OJO con las fechas: `checkIn`/`checkOut` se guardan en UTC y se pintan con
 * `timeZone: "UTC"` (sin eso el día sale corrido); `appointmentAt` es un
 * instante real y va en hora local.
 */
export function ReservationDateHero({
  reservation,
  hasGroup,
  canEditCheckInTime,
  canEditCheckOutTime,
  onPickTime,
}: ReservationDateHeroProps) {
  return (
    <>
      {reservation.reservationType === "DAYCARE" ? (
        <View style={styles.bathHero}>
          <View style={styles.bathBadge}>
            <Ionicons name="sunny" size={14} color={COLORS.primary} />
            <Text style={styles.bathBadgeText}>Guardería</Text>
          </View>
          {reservation.appointmentAt && (
            <View style={styles.bathInfoRow}>
              <Text style={styles.bathDay}>
                {formatWeekdayDayShort(reservation.appointmentAt)}
              </Text>
              {reservation.checkInTime && reservation.checkOutTime && (
                <Text style={styles.bathTime}>
                  {formatTimeHHmm(reservation.checkInTime)}–
                  {formatTimeHHmm(reservation.checkOutTime)}
                </Text>
              )}
            </View>
          )}
        </View>
      ) : reservation.reservationType === "BATH" ? (
        <View style={styles.bathHero}>
          <View style={styles.bathBadge}>
            <Ionicons name="water" size={14} color={COLORS.primary} />
            <Text style={styles.bathBadgeText}>Cita de baño</Text>
          </View>
          {reservation.appointmentAt && (
            <View style={styles.bathInfoRow}>
              <Text style={styles.bathDay}>
                {formatWeekdayDayShort(reservation.appointmentAt)}
              </Text>
              <Text style={styles.bathTime}>
                {formatTime(reservation.appointmentAt)}
              </Text>
            </View>
          )}
        </View>
      ) : (
        reservation.checkIn &&
        reservation.checkOut && (
          <View style={styles.dateHero}>
            <StayDatePill
              label="CHECK-IN"
              date={reservation.checkIn}
              time={reservation.checkInTime ?? null}
              canEditTime={canEditCheckInTime}
              onPickTime={() => onPickTime("in")}
              testID="reservation-checkin-time-chip"
            />

            <View style={styles.dateConnector}>
              <View style={styles.connectorLine} />
              {reservation.totalDays != null && (
                <View style={styles.nightsBadge}>
                  <Ionicons name="moon" size={12} color={COLORS.primary} />
                  <Text style={styles.nightsBadgeText}>
                    {reservation.totalDays}{" "}
                    {reservation.totalDays === 1 ? "noche" : "noches"}
                  </Text>
                </View>
              )}
              <View style={styles.connectorLine} />
            </View>

            <StayDatePill
              label="CHECK-OUT"
              date={reservation.checkOut}
              time={reservation.checkOutTime ?? null}
              canEditTime={canEditCheckOutTime}
              onPickTime={() => onPickTime("out")}
              testID="reservation-checkout-time-chip"
            />
          </View>
        )
      )}

      {reservation.reservationType === "STAY" && (
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <View style={styles.metaIconWrap}>
              <Ionicons name="bed-outline" size={16} color={COLORS.primary} />
            </View>
            <Text style={styles.metaLabel}>Habitación</Text>
            <Text style={styles.metaValue} numberOfLines={1}>
              {reservation.room?.name ?? "Por asignar"}
            </Text>
          </View>
          {!hasGroup && reservation.pet?.breed && (
            <>
              <View style={styles.metaDivider} />
              <View style={styles.metaItem}>
                <View style={styles.metaIconWrap}>
                  <Ionicons name="paw" size={16} color={COLORS.primary} />
                </View>
                <Text style={styles.metaLabel}>Raza</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {reservation.pet.breed}
                </Text>
              </View>
            </>
          )}
        </View>
      )}
    </>
  );
}

/** Un extremo de la estancia: día, día de la semana y chip de hora estimada. */
function StayDatePill({
  label,
  date,
  time,
  canEditTime,
  onPickTime,
  testID,
}: {
  label: string;
  /** `checkIn`/`checkOut` tal cual vienen de la API (UTC). */
  date: string | Date;
  time: string | null;
  canEditTime: boolean;
  onPickTime: () => void;
  testID: string;
}) {
  return (
    <View style={styles.datePill}>
      <Text style={styles.datePillLabel}>{label}</Text>
      <Text style={styles.datePillDay}>
        {formatDayShort(date, { timeZone: "UTC" })}
      </Text>
      <Text style={styles.datePillSub}>
        {formatWeekdayShort(date, { timeZone: "UTC" })}
      </Text>
      {/* El chip sigue visible (deshabilitado) si ya hay hora guardada: quitarlo
          escondería el dato en cuanto pasa la ventana de edición. */}
      {(canEditTime || time) && (
        <TouchableOpacity
          style={[styles.timeChip, time && styles.timeChipSet]}
          onPress={onPickTime}
          disabled={!canEditTime}
          activeOpacity={0.7}
          testID={testID}
        >
          <Ionicons
            name="time-outline"
            size={11}
            color={time ? COLORS.primary : COLORS.textTertiary}
          />
          <Text style={[styles.timeChipText, time && styles.timeChipTextSet]}>
            {time ? formatTimeHHmm(time) : "Indicar hora"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
