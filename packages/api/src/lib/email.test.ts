import { describe, expect, it } from "vitest";
import { reservationConfirmedTemplate } from "./email";

const base = {
  ownerFirstName: "Javi",
  petNames: ["Polo"],
  checkIn: "2026-11-20T00:00:00.000Z",
  checkOut: "2026-11-23T00:00:00.000Z",
  roomName: "Cuarto 01",
  totalAmount: 1500,
  paymentType: "FULL" as const,
  remainingAmount: 0,
};

describe("reservationConfirmedTemplate — qué llevar", () => {
  it("pide llevar alimento y lista lo que pone el hotel (HTML y texto)", () => {
    const t = reservationConfirmedTemplate(base);
    for (const out of [t.html, t.text]) {
      expect(out).toContain("La reserva de Polo está lista. Recuerda llevar su alimento");
      expect(out).toContain("Platos para comida");
      expect(out).toContain("Agua");
      expect(out).toContain("Correa para sus paseos (si tiene permiso para salir)");
    }
  });

  it("varias mascotas: las une con «y»", () => {
    const t = reservationConfirmedTemplate({ ...base, petNames: ["Polo", "Luna"] });
    expect(t.html).toContain("La reserva de Polo y Luna está lista");
  });

  it("las fechas guardadas a las 00:00 UTC no se corren un día", () => {
    const t = reservationConfirmedTemplate(base);
    expect(t.text).toContain("Check-in: 20 de noviembre de 2026");
    expect(t.text).toContain("Check-out: 23 de noviembre de 2026");
  });

  it("escapa los nombres que escribe el cliente", () => {
    const t = reservationConfirmedTemplate({ ...base, ownerFirstName: "<i>J</i>", petNames: ["<b>Polo</b>"] });
    expect(t.html).not.toContain("<b>Polo</b>");
    expect(t.html).not.toContain("<i>J</i>");
    expect(t.html).toContain("&lt;b&gt;Polo&lt;/b&gt;");
  });
});
