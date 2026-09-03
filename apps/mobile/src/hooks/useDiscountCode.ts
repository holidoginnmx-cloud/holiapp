import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { validateReservationDiscount } from "@/lib/api";


import { alertaDeError } from "@/lib/errorAlert";

/**
 * Código de descuento de los wizards de creación (guardería, baño,
 * hospedaje): input + validación en vivo contra la API + descuento aplicado.
 *
 * La validación es solo informativa: el create-intent del backend es la
 * autoridad del monto final.
 *
 * Si cambia el `subtotal` (mascotas, horas, servicios…), el descuento previo
 * puede quedar desactualizado; se limpia para que el usuario lo vuelva a
 * aplicar.
 */
export function useDiscountCode(subtotal: number) {
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    discountTotal: number;
  } | null>(null);
  const [applyingDiscount, setApplyingDiscount] = useState(false);

  async function applyDiscount() {
    const code = discountCodeInput.trim();
    if (!code || subtotal <= 0) return;
    setApplyingDiscount(true);
    try {
      const res = await validateReservationDiscount({ code, subtotal });
      if (res.valid) {
        setAppliedDiscount({ code: code.toUpperCase(), discountTotal: res.discountTotal });
      } else {
        setAppliedDiscount(null);
        Alert.alert("Código de descuento", res.message);
      }
    } catch (err) {
      alertaDeError(err, {
        titulo: "Código de descuento",
        respaldo: "No se pudo validar el código",
      });
    } finally {
      setApplyingDiscount(false);
    }
  }

  function removeDiscount() {
    setAppliedDiscount(null);
    setDiscountCodeInput("");
  }

  useEffect(() => {
    setAppliedDiscount(null);
  }, [subtotal]);

  const discountTotal = appliedDiscount?.discountTotal ?? 0;

  return {
    discountCodeInput,
    setDiscountCodeInput,
    appliedDiscount,
    applyingDiscount,
    applyDiscount,
    removeDiscount,
    discountTotal,
  };
}

export type DiscountCodeState = ReturnType<typeof useDiscountCode>;
