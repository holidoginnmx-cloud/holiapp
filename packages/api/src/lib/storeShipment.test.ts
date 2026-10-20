import { describe, expect, it } from "vitest";

import { buildShipmentMessage, guessCustomerPhone, orderLabel, trackingUrl } from "./storeShipment";

describe("guessCustomerPhone", () => {
  it("saca el teléfono pegado al CP con coma (dirección real del pedido #8)", () => {
    expect(
      guessCustomerPhone(null, "Edulis 126, hacienda las palmas 1 Ixtapaluca 56535,5583355414")
    ).toBe("5583355414");
  });

  it("acepta el número con espacios o guiones y con lada 52", () => {
    expect(guessCustomerPhone(null, "Calle 1, CDMX. Tel 55 8335 5414")).toBe("5583355414");
    expect(guessCustomerPhone(null, "Calle 1, CDMX. +52 55-8335-5414")).toBe("5583355414");
  });

  it("no confunde el CP ni el número de calle con un teléfono", () => {
    expect(guessCustomerPhone(null, "Av. Reyes 126, Centro, 83000 Hermosillo")).toBeNull();
  });

  it("el teléfono del perfil gana sobre la dirección", () => {
    expect(guessCustomerPhone("(662) 123-4567", "… 56535,5583355414")).toBe("6621234567");
  });
});

describe("buildShipmentMessage", () => {
  it("con paquetería conocida lleva el link de rastreo", () => {
    const msg = buildShipmentMessage({
      items: [{ name: "Pelota de Tenis Grande con Squeaker" }],
      firstName: "Rudy",
      carrier: "DHL",
      trackingNumber: "1234567890",
    });
    // Al cliente se le nombra lo que compró, nunca el folio interno.
    expect(msg).toContain(
      "¡Hola, Rudy! 🐾 Tu pedido de Holidog Inn ya va en camino: Pelota de Tenis Grande con Squeaker."
    );
    expect(msg).not.toContain("#");
    expect(msg).toContain("📦 Paquetería: DHL");
    expect(msg).toContain("🔢 Número de guía: 1234567890");
    expect(msg).toContain("tracking-id=1234567890");
  });

  it("sin link conocido indica rastrear en la página de la paquetería", () => {
    const msg = buildShipmentMessage({
      items: [{ name: "Collar" }],
      firstName: null,
      carrier: "Estafeta",
      trackingNumber: "ABC 123",
    });
    expect(msg.startsWith("¡Hola! 🐾")).toBe(true);
    expect(msg).toContain("en la página de Estafeta con tu número de guía");
    expect(trackingUrl("Estafeta", "ABC 123")).toBeNull();
  });
});

describe("orderLabel", () => {
  it("nombra lo que se compró", () => {
    expect(orderLabel([{ name: "Collar" }])).toBe("Collar");
    expect(orderLabel([{ name: "Collar" }, { name: "Correa" }])).toBe("Collar y Correa");
    expect(orderLabel([{ name: "A" }, { name: "B" }, { name: "C" }])).toBe("A, B y 1 producto más");
    expect(orderLabel([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }])).toBe(
      "A, B y 2 productos más"
    );
    expect(orderLabel([])).toBe("tu compra");
  });
});
