import "dotenv/config";
import { Database } from "./db";
import { createApp } from "./app";
async function main() {
  const db = new Database();
  await db.open();
  const app = await createApp(db);
  await app.listen(Number(process.env.PORT || 4000), "127.0.0.1");
  console.log("Invictus API disponível em http://127.0.0.1:4000");
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await db.close();
    if (process.connected) process.disconnect();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.on("message", (message) => {
    if (message === "shutdown") void stop();
  });
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
