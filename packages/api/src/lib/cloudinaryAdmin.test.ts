import { describe, expect, it } from "vitest";
import { publicIdFromUrl } from "./cloudinaryAdmin";

// `publicIdFromUrl` decide QUÉ archivo se borra de Cloudinary. Si devolviera de
// más (por ejemplo, tragándose la carpeta) o de menos, la purga podría no
// borrar nada o, peor, apuntar a otro archivo. De ahí esta batería.

describe("publicIdFromUrl", () => {
  it("saca el public_id de una URL de video tal como la guarda la app", () => {
    expect(
      publicIdFromUrl(
        "https://res.cloudinary.com/dbquowtui/video/upload/v1787005873/checklists/m1rcltqybrk0gnvpaugx.mov"
      )
    ).toBe("checklists/m1rcltqybrk0gnvpaugx");
  });

  it("acepta .mp4 igual que .mov", () => {
    expect(
      publicIdFromUrl(
        "https://res.cloudinary.com/dbquowtui/video/upload/v1789489287/checklists/q509cz6iftqqeveuxvjf.mp4"
      )
    ).toBe("checklists/q509cz6iftqqeveuxvjf");
  });

  it("ignora las transformaciones que mete cloudinaryResized", () => {
    expect(
      publicIdFromUrl(
        "https://res.cloudinary.com/dbquowtui/video/upload/c_fill,w_360,q_auto,f_auto/v1787005873/checklists/abc123.jpg"
      )
    ).toBe("checklists/abc123");
  });

  it("funciona sin versión", () => {
    expect(
      publicIdFromUrl(
        "https://res.cloudinary.com/dbquowtui/video/upload/checklists/abc123.mov"
      )
    ).toBe("checklists/abc123");
  });

  it("conserva las carpetas anidadas", () => {
    expect(
      publicIdFromUrl(
        "https://res.cloudinary.com/dbquowtui/image/upload/v1784231103/holidoginn/store/IMG_5849.png"
      )
    ).toBe("holidoginn/store/IMG_5849");
  });

  it("no toca lo que no es de Cloudinary (hay fotos en Supabase Storage)", () => {
    expect(
      publicIdFromUrl(
        "https://vywghpkeagfkbwdfiwod.supabase.co/storage/v1/object/public/fotos/perro.jpg"
      )
    ).toBeNull();
  });

  it("devuelve null si la URL no trae /upload/", () => {
    expect(publicIdFromUrl("https://res.cloudinary.com/dbquowtui/video/abc.mov")).toBeNull();
    expect(publicIdFromUrl("")).toBeNull();
  });

  it("nunca se come el único segmento que queda", () => {
    // Un archivo en la raíz, sin carpeta: `v123/foto.jpg` -> `foto`.
    expect(
      publicIdFromUrl("https://res.cloudinary.com/dbquowtui/image/upload/v123/foto.jpg")
    ).toBe("foto");
  });
});
