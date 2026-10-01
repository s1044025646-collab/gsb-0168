import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppDatabase } from "./db.js";
import { createApp } from "./api.js";

const dataDir = process.env.HYDRO_DATA_DIR ?? join(process.cwd(), ".data");
const dbPath = process.env.HYDRO_DB_PATH ?? join(dataDir, "hydro.sqlite");
const portFile = process.env.HYDRO_PORT_FILE ?? join(dataDir, "server.port");
const db = new AppDatabase(dbPath);
const server = createApp(db);

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to acquire local port");
  writeFileSync(portFile, `${address.port}\n${process.pid}\n`, "utf8");
  console.log(JSON.stringify({ status: "listening", host: "127.0.0.1", port: address.port, pid: process.pid, dbPath, portFile }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ status: "stopping", signal }));
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
