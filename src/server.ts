import "dotenv/config";
import app from "./app";
import { PORT } from "./config/index.config";
import { prisma } from "./config/prisma";

async function start() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required to start the API");
  await prisma.$connect();
  const server = app.listen(PORT, () => {
    console.log(JSON.stringify({ event: "api_started", port: PORT }));
  });
  server.on("error", async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(async () => {
      await prisma.$disconnect();
      clearTimeout(deadline);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
