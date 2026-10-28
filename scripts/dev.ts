import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
const run = (file: string, args: string[], ipc = false) =>
  spawn(process.execPath, [resolve(file), ...args], {
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
    env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.server.json" },
  });
const api = run("dist/src/server/main.js", [], true);
let web: ChildProcess | undefined;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (api.connected) api.send("shutdown", () => {});
  else api.kill();
  web?.kill();
  setTimeout(() => {
    if (api.exitCode === null) api.kill();
  }, 5000).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
api.on("exit", (code) => {
  if (code) stop();
});
async function startWeb() {
  const deadline = Date.now() + 60000;
  while (!stopping && Date.now() < deadline) {
    try {
      const r = await fetch(
        `http://127.0.0.1:${process.env.PORT || 4000}/api/health`,
        { signal: AbortSignal.timeout(1000) },
      );
      if (r.ok) {
        web = run("node_modules/next/dist/bin/next", [
          "dev",
          "--hostname",
          "127.0.0.1",
        ]);
        web.on("exit", stop);
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!stopping) {
    console.error("A API não ficou pronta para iniciar a interface.");
    process.exitCode = 1;
    stop();
  }
}
void startWeb();
