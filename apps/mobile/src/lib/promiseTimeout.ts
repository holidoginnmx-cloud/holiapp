/**
 * Le pone un tope de espera a una promesa que podría no resolver nunca.
 *
 * En la app esto pasa de verdad: `fetch` de React Native no tiene timeout y la
 * hoja de pago de Stripe deja su promesa pendiente si iOS no la pudo presentar.
 * Sin este tope, la pantalla se queda con el spinner girando sin error ni
 * salida — el usuario solo puede matar la app.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
