import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] ?? "aaron@fresafit.com.mx";

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, creditBalance: true },
  });

  if (!user) {
    console.log(`❌ No se encontró usuario con email ${email}`);
    return;
  }

  console.log("👤 Usuario:");
  console.log(`   ${user.firstName} (${user.email})`);
  console.log(`   creditBalance ahora: $${user.creditBalance.toString()}`);
  console.log("");

  const recent = await prisma.reservation.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 3,
    include: {
      payments: { orderBy: { paidAt: "desc" } },
      pet: { select: { name: true } },
    },
  });

  if (recent.length === 0) {
    console.log("❌ No hay reservaciones para este usuario");
    return;
  }

  for (const r of recent) {
    const paid = r.payments.reduce(
      (acc, p) => acc + (p.status === "PAID" || p.status === "PARTIAL" ? Number(p.amount) : 0),
      0
    );
    const pending = Number(r.totalAmount) - paid;

    console.log(`📅 Reserva ${r.id.slice(0, 8)}…  (${r.pet.name})`);
    console.log(`   creada: ${r.createdAt.toISOString()}`);
    console.log(`   total:  $${r.totalAmount.toString()}   paymentType: ${r.paymentType ?? "-"}`);
    console.log(`   pagado: $${paid.toFixed(2)}   pendiente: $${pending.toFixed(2)}`);
    if (r.payments.length === 0) {
      console.log("   (sin pagos)");
    } else {
      for (const p of r.payments) {
        console.log(
          `   • Payment ${p.id.slice(0, 8)}… method=${p.method} status=${p.status} $${p.amount.toString()}` +
            (p.notes ? `  "${p.notes}"` : "") +
            (p.stripePaymentIntentId ? `  stripe=${p.stripePaymentIntentId.slice(0, 14)}…` : "")
        );
      }
    }
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
