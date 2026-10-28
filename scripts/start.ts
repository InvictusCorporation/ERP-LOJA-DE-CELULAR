import { spawn } from "node:child_process";
import { resolve } from "node:path";
process.env.NODE_ENV = "production";
const api = spawn(process.execPath, ["dist/src/server/main.js"], {
  stdio: ["inherit", "inherit", "inherit", "ipc"],
  env: process.env,
});
const web = spawn(
  process.execPath,
  [
    resolve("node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "0.0.0.0",
  ],
  { stdio: "inherit", env: process.env },
);
const stop = () => {
  if (api.connected) api.send("shutdown");
  else api.kill();
  web.kill();
  setTimeout(() => {
    if (api.exitCode === null) api.kill();
  }, 5000).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
