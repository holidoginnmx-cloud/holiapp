import { FastifyInstance } from "fastify";
import { Prisma } from "@holidoginn/db";
import { CreateProductReviewSchema } from "@holidoginn/shared";
import { createAuthMiddleware } from "../middleware/auth";

// ---------------------------------------------------------------------------
// Tienda en línea — catálogo PÚBLICO (sin auth) + reseñas.
// Rutas:
//   GET  /store/products                  lista (?category, ?featured, ?q, ?sort, ?limit, ?offset)
//   GET  /store/products/:slug            detalle (variantes, imágenes, rating, recomendados)
//   GET  /store/categories                categorías activas
//   GET  /store/products/:slug/reviews    reseñas APROBADAS (público)
//   POST /store/products/:slug/reviews    crear reseña (auth; entra como pendiente)
// ---------------------------------------------------------------------------

// Una variante está disponible si está activa y (no controla stock o hay > 0).
function variantInStock(v: {
  isActive: boolean;
  inventory: { quantity: number; trackInventory: boolean } | null;
}): boolean {
  if (!v.isActive) return false;
  if (!v.inventory || !v.inventory.trackInventory) return true;
  return v.inventory.quantity > 0;
}

type SortKey = "featured" | "price_asc" | "price_desc" | "name" | "newest";
const SORT_KEYS: SortKey[] = ["featured", "price_asc", "price_desc", "name", "newest"];

// Forma mínima que necesita toProductListItem (cualquier producto con estas
// relaciones es asignable; las queries incluyen más campos).
type RatedProductRow = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: { slug: string; name: string } | null;
  images: { url: string; isPrimary: boolean }[];
  variants: { isActive: boolean; price: Prisma.Decimal; inventory: { quantity: number; trackInventory: boolean } | null }[];
  reviews: { rating: number }[];
};

// Include compartido para listar/recomendar (deriva precio, stock y rating).
const LIST_INCLUDE = {
  category: { select: { slug: true, name: true } },
  images: { orderBy: { sortOrder: "asc" } },
  variants: { include: { inventory: true } },
  reviews: { where: { isApproved: true }, select: { rating: true } },
} satisfies Prisma.ProductInclude;

function ratingOf(reviews: { rating: number }[]): { ratingAvg: number | null; ratingCount: number } {
  const ratingCount = reviews.length;
  const ratingAvg = ratingCount
    ? Number((reviews.reduce((s, r) => s + r.rating, 0) / ratingCount).toFixed(2))
    : null;
  return { ratingAvg, ratingCount };
}

function toProductListItem(p: RatedProductRow) {
  const activeVariants = p.variants.filter((v) => v.isActive);
  const precios = activeVariants.map((v) => Number(v.price));
  const primary = p.images.find((img) => img.isPrimary) ?? p.images[0] ?? null;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    category: p.category,
    imageUrl: primary?.url ?? null,
    priceMin: precios.length ? Math.min(...precios) : null,
    priceMax: precios.length ? Math.max(...precios) : null,
    inStock: activeVariants.some((v) =>
      variantInStock({ isActive: v.isActive, inventory: v.inventory })
    ),
    ...ratingOf(p.reviews),
  };
}

// Orden en memoria: el precio vive en las variantes (priceMin/priceMax derivados),
// así que no se puede ordenar por precio a nivel SQL de forma simple. El catálogo
// es pequeño, por lo que ordenar/paginar en memoria es correcto y simple.
function sortProducts<
  T extends {
    name: string;
    isFeatured: boolean;
    createdAt: Date;
    priceMin: number | null;
    priceMax: number | null;
  }
>(items: T[], sort: SortKey): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "es");
  const priceOr = (v: number | null, fallback: number) => (v === null ? fallback : v);
  const copy = [...items];
  switch (sort) {
    case "price_asc":
      return copy.sort((a, b) => priceOr(a.priceMin, Infinity) - priceOr(b.priceMin, Infinity) || byName(a, b));
    case "price_desc":
      return copy.sort((a, b) => priceOr(b.priceMax, -Infinity) - priceOr(a.priceMax, -Infinity) || byName(a, b));
    case "name":
      return copy.sort(byName);
    case "newest":
      return copy.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || byName(a, b));
    case "featured":
    default:
      return copy.sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || byName(a, b));
  }
}

export default async function productsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  fastify.get<{
    Querystring: {
      category?: string;
      featured?: string;
      q?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    };
  }>("/store/products", async (request) => {
    const { category, featured, q } = request.query;
    const sort: SortKey = SORT_KEYS.includes(request.query.sort as SortKey)
      ? (request.query.sort as SortKey)
      : "featured";
    // limit por defecto 24; tope 100 para no abusar. offset >= 0.
    const limit = Math.min(Math.max(parseInt(request.query.limit ?? "24", 10) || 24, 1), 100);
    const offset = Math.max(parseInt(request.query.offset ?? "0", 10) || 0, 0);
    const search = (q ?? "").trim();

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(featured === "1" || featured === "true" ? { isFeatured: true } : {}),
        ...(category ? { category: { slug: category } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { brand: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: LIST_INCLUDE,
    });

    const mapped = products.map((p) => ({
      ...toProductListItem(p),
      // Solo para ordenar en memoria; no se exponen al cliente.
      isFeatured: p.isFeatured,
      createdAt: p.createdAt,
    }));

    const total = mapped.length;
    const page = sortProducts(mapped, sort)
      .slice(offset, offset + limit)
      .map(({ isFeatured: _f, createdAt: _c, ...rest }) => rest);

    return { products: page, total };
  });

  fastify.get<{ Params: { slug: string } }>(
    "/store/products/:slug",
    async (request, reply) => {
      const product = await prisma.product.findUnique({
        where: { slug: request.params.slug },
        include: {
          category: { select: { slug: true, name: true } },
          images: { orderBy: { sortOrder: "asc" } },
          variants: { include: { inventory: true }, orderBy: { createdAt: "asc" } },
          reviews: { where: { isApproved: true }, select: { rating: true } },
        },
      });

      if (!product || !product.isActive) {
        return reply.status(404).send({ error: "Producto no encontrado" });
      }

      // Recomendados: misma categoría, excluyendo el actual. El frontend filtra
      // pseudo-productos (baño/reserva) y recorta a 4.
      const related = product.categoryId
        ? await prisma.product.findMany({
            where: { isActive: true, categoryId: product.categoryId, id: { not: product.id } },
            include: LIST_INCLUDE,
            orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
            take: 8,
          })
        : [];

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        brand: product.brand,
        vendor: product.vendor,
        category: product.category,
        ...ratingOf(product.reviews),
        images: product.images.map((img) => ({
          id: img.id,
          url: img.url,
          alt: img.alt,
          isPrimary: img.isPrimary,
          variantId: img.variantId,
        })),
        variants: product.variants
          .filter((v) => v.isActive)
          .map((v) => ({
            id: v.id,
            title: v.title,
            sku: v.sku,
            option1Name: v.option1Name,
            option1Value: v.option1Value,
            option2Name: v.option2Name,
            option2Value: v.option2Value,
            price: Number(v.price),
            compareAtPrice: v.compareAtPrice === null ? null : Number(v.compareAtPrice),
            inStock: variantInStock({ isActive: v.isActive, inventory: v.inventory }),
          })),
        related: related.map(toProductListItem),
      };
    }
  );

  fastify.get("/store/categories", async () => {
    const categories = await prisma.productCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, slug: true, name: true, description: true, imageUrl: true },
    });
    return { categories };
  });

  // Reseñas APROBADAS de un producto (público).
  fastify.get<{ Params: { slug: string } }>(
    "/store/products/:slug/reviews",
    async (request, reply) => {
      const product = await prisma.product.findUnique({
        where: { slug: request.params.slug },
        select: { id: true },
      });
      if (!product) return reply.status(404).send({ error: "Producto no encontrado" });

      const reviews = await prisma.productReview.findMany({
        where: { productId: product.id, isApproved: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          authorName: true,
          orderId: true,
          createdAt: true,
        },
      });

      return {
        ...ratingOf(reviews),
        reviews: reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          title: r.title,
          body: r.body,
          authorName: r.authorName,
          verified: r.orderId !== null,
          createdAt: r.createdAt,
        })),
      };
    }
  );

  // Crear reseña (requiere sesión). Entra como NO aprobada; el admin la modera.
  fastify.post<{ Params: { slug: string } }>(
    "/store/products/:slug/reviews",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateProductReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Datos de reseña inválidos" });
      }

      const product = await prisma.product.findUnique({
        where: { slug: request.params.slug },
        select: { id: true, isActive: true },
      });
      if (!product || !product.isActive) {
        return reply.status(404).send({ error: "Producto no encontrado" });
      }

      // Una sola reseña por usuario y producto.
      const existing = await prisma.productReview.findFirst({
        where: { productId: product.id, userId: request.userId },
        select: { id: true },
      });
      if (existing) {
        return reply.status(409).send({ error: "Ya dejaste una reseña para este producto" });
      }

      // Compra verificada: ¿hay una orden PAID/FULFILLED del usuario con este producto?
      const purchase = await prisma.order.findFirst({
        where: {
          userId: request.userId,
          status: { in: ["PAID", "FULFILLED"] },
          items: { some: { variant: { productId: product.id } } },
        },
        select: { id: true },
      });

      await prisma.productReview.create({
        data: {
          productId: product.id,
          userId: request.userId,
          orderId: purchase?.id ?? null,
          rating: parsed.data.rating,
          title: parsed.data.title?.trim() || null,
          body: parsed.data.body.trim(),
          authorName: parsed.data.authorName.trim(),
          isApproved: false,
        },
      });

      return reply
        .status(201)
        .send({ ok: true, message: "¡Gracias! Tu reseña se publicará tras revisión." });
    }
  );
}
