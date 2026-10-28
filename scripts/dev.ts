import { spawn } from "node:child_process";
import { resolve } from "node:path";
const run = (file: string, args: string[], ipc = false) =>
  spawn(process.execPath, [resolve(file), ...args], {
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
    env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.server.json" },
  });
const api = run("dist/src/server/main.js", [], true);
const web = run("node_modules/next/dist/bin/next", [
  "dev",
  "--hostname",
  "127.0.0.1",
]);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (api.connected) api.send("shutdown");
  else api.kill();
  web.kill();
  setTimeout(() => {
    if (api.exitCode === null) api.kill();
  }, 5000).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
api.on("exit", (code) => {
  if (code) stop();
});
web.on("exit", () => stop());
