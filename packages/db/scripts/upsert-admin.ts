import { prisma } from "../src/index";

const TARGET = {
  clerkId: "user_3D1GPy0JlybZHWUdDujdt5WmXoC",
  email: "javier1234@gmail.com",
  firstName: "Javier",
  lastName: "Oviedo",
  role: "ADMIN" as const,
  phone: "+52 55 0000 0000",
};

async function run() {
  // Buscar primero por clerkId (identidad inmutable)
  let user = await prisma.user.findUnique({ where: { clerkId: TARGET.clerkId } });

  // Si no, por email (por si auth middleware ya lo creó sin clerkId vinculado)
  if (!user) {
    user = await prisma.user.findUnique({ where: { email: TARGET.email } });
  }

  if (user) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        clerkId: TARGET.clerkId,
        email: TARGET.email,
        firstName: TARGET.firstName,
        lastName: TARGET.lastName,
        role: TARGET.role,
        phone: TARGET.phone,
        isActive: true,
      },
    });
    console.log("✅ Usuario actualizado:");
    console.log(updated);
  } else {
    const created = await prisma.user.create({
      data: TARGET,
    });
    console.log("✅ Usuario creado:");
    console.log(created);
  }
}

run()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
