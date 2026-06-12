/**
 * import-shopify.ts — Importación de los productos de la tienda Shopify
 * (holidoginn.com.mx) al esquema de e-commerce de Prisma (Product,
 * ProductVariant, ProductImage, Inventory, ProductCategory, DiscountCode).
 *
 * Reemplaza la tienda Shopify por el sitio Next.js nuevo (HolidogInn-site).
 *
 * Propiedades:
 *  - IDEMPOTENTE: upsert por shopifyProductId / shopifyVariantId / slug. Se
 *    puede re-ejecutar sin duplicar.
 *  - EXCLUYE "Reserva de Hotel": ese producto NO se migra; el sitio usa el
 *    flujo real de reservación de la API (precio por peso, 20%/completo).
 *  - IMÁGENES: por ahora se guarda la URL del CDN de Shopify (cdn.shopify.com),
 *    ya permitida en next.config. En el cutover (F6) se migran al bucket
 *    'productos' de Supabase (ver TODO al final).
 *
 * Auth: client credentials grant (app que accede solo a sus propios datos).
 *   https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 *
 * Uso:
 *   SHOPIFY_SHOP=tu-tienda.myshopify.com \
 *   SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... \
 *   DATABASE_URL=<unified> npx tsx scripts/import-shopify.ts
 *
 *   # Solo verificar conteos contra Shopify (no escribe):
 *   ... npx tsx scripts/import-shopify.ts --verify
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Carga de .env (packages/db/.env) si DATABASE_URL no está en el entorno.
// Mismo .env que usa Prisma; sin añadir dependencia de dotenv.
// ---------------------------------------------------------------------------
function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  try {
    const envPath = join(__dirname, "..", ".env");
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && m[1] && !process.env[m[1]]) {
        process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // sin .env: se asume que las vars vienen del entorno
  }
}
loadDotEnv();

const VERIFY_ONLY = process.argv.includes("--verify");
const API_VERSION = "2024-10";

// Modo público: lee del storefront `/products.json` (sin auth, sin scope).
// Útil cuando la app Shopify aún no tiene aprobado read_products. No trae
// inventario ni colecciones; el admin ajusta stock/categoría después.
const PUBLIC_MODE = process.argv.includes("--public");

const SHOP = requireEnv("SHOPIFY_SHOP").replace(/^https?:\/\//, "").replace(/\/$/, "");
const CLIENT_ID = PUBLIC_MODE ? "" : requireEnv("SHOPIFY_CLIENT_ID");
const CLIENT_SECRET = PUBLIC_MODE ? "" : requireEnv("SHOPIFY_CLIENT_SECRET");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ Falta la variable de entorno ${name}.`);
    process.exit(1);
  }
  return v;
}

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Tipos de la Admin API de Shopify (campos que usamos).
// ---------------------------------------------------------------------------
interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  position: number;
  variant_ids: number[];
}
interface ShopifyVariant {
  id: number;
  title: string;
  sku: string | null;
  price: string;
  compare_at_price: string | null;
  option1: string | null;
  option2: string | null;
  inventory_quantity: number | null;
  inventory_management: string | null; // "shopify" => trackear stock
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  status: string; // "active" | "draft" | "archived"
  tags: string;
  options: { name: string; position: number }[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}
interface ShopifyCollection {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
}

// ---------------------------------------------------------------------------
// Cliente Shopify Admin API.
// ---------------------------------------------------------------------------
let accessToken: string | null = null;

async function getAccessToken(): Promise<string> {
  if (accessToken) return accessToken;
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `No se pudo obtener el access token de Shopify (${res.status}): ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { access_token: string };
  accessToken = data.access_token;
  return accessToken;
}

/** GET paginado de la Admin API (sigue el header Link rel="next"). */
async function shopifyGetAll<T>(resource: string, key: string): Promise<T[]> {
  const token = await getAccessToken();
  const out: T[] = [];
  let url: string | null = `https://${SHOP}/admin/api/${API_VERSION}/${resource}.json?limit=250`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) {
      throw new Error(`Shopify GET ${resource} falló (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as Record<string, T[]>;
    out.push(...(json[key] ?? []));
    url = parseNextLink(res.headers.get("link"));
  }
  return out;
}

/** GET paginado del storefront público `/products.json` (sin auth). */
async function fetchProductsPublic(): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`https://${SHOP}/products.json?limit=250&page=${page}`);
    if (!res.ok) {
      throw new Error(`Storefront GET products.json falló (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { products: ShopifyProduct[] };
    const batch = json.products ?? [];
    out.push(...batch);
    if (batch.length < 250) break;
  }
  return out;
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers de mapeo.
// ---------------------------------------------------------------------------
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const usedSlugs = new Set<string>();
function uniqueSlug(base: string, fallback: string): string {
  let slug = base || fallback;
  let i = 2;
  while (usedSlugs.has(slug)) slug = `${base}-${i++}`;
  usedSlugs.add(slug);
  return slug;
}

/** Marca de marca a partir de vendor/tags (ProBarf, Sharpaw, etc.). */
function inferBrand(p: ShopifyProduct): string | null {
  const haystack = `${p.title} ${p.tags} ${p.vendor ?? ""}`.toLowerCase();
  if (haystack.includes("probarf") || haystack.includes("barf")) return "ProBarf";
  if (haystack.includes("sharpaw")) return "Sharpaw";
  return null;
}

const IS_RESERVA = (title: string) => /reserva\s+de\s+hotel/i.test(title);

// ---------------------------------------------------------------------------
// Importación principal.
// ---------------------------------------------------------------------------
async function main() {
  console.log(
    `→ Conectando a Shopify: ${SHOP} ${PUBLIC_MODE ? "(storefront público)" : `(Admin API ${API_VERSION})`}`,
  );

  let products: ShopifyProduct[];
  let collections: ShopifyCollection[] = [];
  const productToCollection = new Map<number, number>();

  if (PUBLIC_MODE) {
    products = await fetchProductsPublic();
  } else {
    const [prods, customCollections, smartCollections] = await Promise.all([
      shopifyGetAll<ShopifyProduct>("products", "products"),
      shopifyGetAll<ShopifyCollection>("custom_collections", "custom_collections").catch(() => []),
      shopifyGetAll<ShopifyCollection>("smart_collections", "smart_collections").catch(() => []),
    ]);
    products = prods;
    collections = [...customCollections, ...smartCollections];

    // collects: mapeo producto → colección (para asignar categoría).
    const collects = await shopifyGetAll<{ product_id: number; collection_id: number }>(
      "collects",
      "collects",
    ).catch(() => []);
    for (const c of collects) {
      if (!productToCollection.has(c.product_id)) {
        productToCollection.set(c.product_id, c.collection_id);
      }
    }
  }

  const importable = products.filter((p) => !IS_RESERVA(p.title));
  const skipped = products.length - importable.length;

  console.log(
    `→ Shopify: ${products.length} productos (${skipped} "Reserva de Hotel" excluidos), ` +
      `${collections.length} colecciones.`,
  );

  if (VERIFY_ONLY) {
    await verify(importable);
    return;
  }

  // 1) Categorías (colecciones).
  const collectionIdToCategoryId = new Map<number, string>();
  for (const col of collections) {
    const slug = uniqueSlug(slugify(col.title), `coleccion-${col.id}`);
    const cat = await prisma.productCategory.upsert({
      where: { slug },
      create: {
        slug,
        name: col.title,
        description: stripHtml(col.body_html),
      },
      update: { name: col.title, description: stripHtml(col.body_html) },
    });
    collectionIdToCategoryId.set(col.id, cat.id);
  }
  console.log(`✓ ${collectionIdToCategoryId.size} categorías.`);

  // 2) Productos + variantes + inventario + imágenes.
  let nProducts = 0;
  let nVariants = 0;
  let nImages = 0;

  for (const p of importable) {
    const collectionId = productToCollection.get(p.id);
    const categoryId = collectionId ? collectionIdToCategoryId.get(collectionId) ?? null : null;
    const slug = uniqueSlug(slugify(p.handle || p.title), `producto-${p.id}`);
    const optionNames = p.options.map((o) => o.name);

    const product = await prisma.product.upsert({
      where: { shopifyProductId: String(p.id) },
      create: {
        slug,
        name: p.title,
        description: stripHtml(p.body_html),
        vendor: p.vendor || "HolidogInn",
        brand: inferBrand(p),
        isActive: PUBLIC_MODE ? true : p.status === "active",
        shopifyProductId: String(p.id),
        categoryId,
      },
      update: {
        name: p.title,
        description: stripHtml(p.body_html),
        vendor: p.vendor || "HolidogInn",
        brand: inferBrand(p),
        isActive: PUBLIC_MODE ? true : p.status === "active",
        categoryId,
      },
    });
    nProducts++;

    // Variantes + inventario.
    for (const v of p.variants) {
      const variant = await prisma.productVariant.upsert({
        where: { shopifyVariantId: String(v.id) },
        create: {
          productId: product.id,
          shopifyVariantId: String(v.id),
          sku: v.sku || null,
          title: v.title,
          option1Name: optionNames[0] ?? null,
          option1Value: v.option1,
          option2Name: optionNames[1] ?? null,
          option2Value: v.option2,
          price: new Prisma.Decimal(v.price || "0"),
          compareAtPrice: v.compare_at_price ? new Prisma.Decimal(v.compare_at_price) : null,
        },
        update: {
          sku: v.sku || null,
          title: v.title,
          option1Name: optionNames[0] ?? null,
          option1Value: v.option1,
          option2Name: optionNames[1] ?? null,
          option2Value: v.option2,
          price: new Prisma.Decimal(v.price || "0"),
          compareAtPrice: v.compare_at_price ? new Prisma.Decimal(v.compare_at_price) : null,
        },
      });
      nVariants++;

      const tracks = v.inventory_management === "shopify";
      await prisma.inventory.upsert({
        where: { variantId: variant.id },
        create: {
          variantId: variant.id,
          quantity: Math.max(0, v.inventory_quantity ?? 0),
          trackInventory: tracks,
        },
        update: {
          quantity: Math.max(0, v.inventory_quantity ?? 0),
          trackInventory: tracks,
        },
      });
    }

    // Imágenes: regenerar (idempotente) usando la URL del CDN de Shopify.
    const shopifyVariantToLocal = new Map<number, string>();
    const localVariants = await prisma.productVariant.findMany({
      where: { productId: product.id },
      select: { id: true, shopifyVariantId: true },
    });
    for (const lv of localVariants) {
      if (lv.shopifyVariantId) shopifyVariantToLocal.set(Number(lv.shopifyVariantId), lv.id);
    }

    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    for (const img of p.images.sort((a, b) => a.position - b.position)) {
      const variantId =
        img.variant_ids.length > 0
          ? shopifyVariantToLocal.get(img.variant_ids[0]!) ?? null
          : null;
      await prisma.productImage.create({
        data: {
          productId: product.id,
          variantId,
          url: img.src, // TODO(F6): descargar y subir al bucket 'productos' de Supabase.
          alt: img.alt,
          sortOrder: img.position,
          isPrimary: img.position === 1,
        },
      });
      nImages++;
    }
  }

  console.log(`✓ ${nProducts} productos, ${nVariants} variantes, ${nImages} imágenes.`);

  // 3) Código de descuento WEB10 (10% primera compra).
  await prisma.discountCode.upsert({
    where: { code: "WEB10" },
    create: {
      code: "WEB10",
      type: "PERCENT",
      value: new Prisma.Decimal(10),
      firstOrderOnly: true,
      isActive: true,
    },
    update: {},
  });
  console.log(`✓ Código de descuento WEB10 listo.`);

  await verify(importable);
}

function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

async function verify(importable: ShopifyProduct[]) {
  const expectedProducts = importable.length;
  const expectedVariants = importable.reduce((n, p) => n + p.variants.length, 0);
  const expectedImages = importable.reduce((n, p) => n + p.images.length, 0);

  const [dbProducts, dbVariants, dbImages] = await Promise.all([
    prisma.product.count({ where: { shopifyProductId: { not: null } } }),
    prisma.productVariant.count({ where: { shopifyVariantId: { not: null } } }),
    prisma.productImage.count({ where: { product: { shopifyProductId: { not: null } } } }),
  ]);

  const row = (label: string, exp: number, got: number) =>
    `  ${got === exp ? "✓" : "✗"} ${label}: Shopify=${exp}  DB=${got}`;

  console.log("\n── Verificación ──────────────────────────────");
  console.log(row("Productos", expectedProducts, dbProducts));
  console.log(row("Variantes", expectedVariants, dbVariants));
  console.log(row("Imágenes", expectedImages, dbImages));
  console.log("──────────────────────────────────────────────");

  if (dbProducts !== expectedProducts || dbVariants !== expectedVariants) {
    console.log("⚠ Los conteos no cuadran. Revisa antes de dar por buena la migración.");
  } else {
    console.log("✓ Conteos OK.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
