import { Alert } from "react-native";
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

type Patch<TVars> = {
  /** Entrada de caché a parchear (key exacta, no prefijo). */
  queryKey: QueryKey;
  /** Transformación pura del caché. Si la entrada no existe devuelve `old`. */
  updater: (old: unknown, vars: TVars) => unknown;
};

type Snapshot = readonly [QueryKey, unknown];

/**
 * Mutación con actualización optimista: parchea el caché en el mismo frame
 * del tap, revierte si el servidor rechaza y reconcilia con invalidaciones
 * DIRIGIDAS al terminar. Solo para escrituras de estado reversibles (rol,
 * activo/inactivo, resolver alerta, asignar staff/cuarto...). Las escrituras
 * de dinero NO van aquí: usan isPending + banner (el servidor es la autoridad).
 */
export function useOptimisticMutation<TData, TVars>(opts: {
  mutationFn: (vars: TVars) => Promise<TData>;
  patches: Patch<TVars>[];
  /** Keys a invalidar en onSettled (reconciliación en background). */
  invalidateKeys?: QueryKey[];
  onSuccess?: (data: TData, vars: TVars) => void;
  errorTitle?: string;
}) {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVars, { snapshots: Snapshot[] }>({
    mutationFn: opts.mutationFn,
    onMutate: async (vars) => {
      // Cancela refetches en vuelo para que no pisen el parche optimista.
      await Promise.all(
        opts.patches.map((p) => queryClient.cancelQueries({ queryKey: p.queryKey }))
      );
      const snapshots: Snapshot[] = opts.patches.map(
        (p) => [p.queryKey, queryClient.getQueryData(p.queryKey)] as const
      );
      for (const p of opts.patches) {
        queryClient.setQueryData(p.queryKey, (old: unknown) =>
          old === undefined ? old : p.updater(old, vars)
        );
      }
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
      Alert.alert(opts.errorTitle ?? "Error", err.message);
    },
    onSuccess: opts.onSuccess,
    onSettled: () => {
      opts.invalidateKeys?.forEach((key) =>
        queryClient.invalidateQueries({ queryKey: key })
      );
    },
  });
}
