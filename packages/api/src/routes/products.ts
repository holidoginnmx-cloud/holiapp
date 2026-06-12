import { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Tienda en línea — catálogo PÚBLICO (sin auth). Reemplaza la tienda Shopify.
// Rutas:
//   GET /store/products              lista (filtros: ?category=slug, ?featured=1)
//   GET /store/products/:slug        detalle con variantes, imágenes, stock
//   GET /store/categories            categorías activas
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

export default async function productsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;

  fastify.get<{ Querystring: { category?: string; featured?: string } }>(
    "/store/products",
    async (request) => {
      const { category, featured } = request.query;

      const products = await prisma.product.findMany({
        where: {
          isActive: true,
          ...(featured === "1" || featured === "true" ? { isFeatured: true } : {}),
          ...(category ? { category: { slug: category } } : {}),
        },
        include: {
          category: { select: { slug: true, name: true } },
          images: { orderBy: { sortOrder: "asc" } },
          variants: { include: { inventory: true } },
        },
        orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
      });

      return {
        products: products.map((p) => {
          const activeVariants = p.variants.filter((v) => v.isActive);
          const precios = activeVariants.map((v) => Number(v.price));
          const primary =
            p.images.find((img) => img.isPrimary) ?? p.images[0] ?? null;
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
          };
        }),
      };
    }
  );

  fastify.get<{ Params: { slug: string } }>(
    "/store/products/:slug",
    async (request, reply) => {
      const product = await prisma.product.findUnique({
        where: { slug: request.params.slug },
        include: {
          category: { select: { slug: true, name: true } },
          images: { orderBy: { sortOrder: "asc" } },
          variants: { include: { inventory: true }, orderBy: { createdAt: "asc" } },
        },
      });

      if (!product || !product.isActive) {
        return reply.status(404).send({ error: "Producto no encontrado" });
      }

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        brand: product.brand,
        vendor: product.vendor,
        category: product.category,
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
}
