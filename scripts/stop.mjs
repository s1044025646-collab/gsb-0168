import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const portFile = process.env.HYDRO_PORT_FILE ?? join(process.cwd(), ".data", "server.port");
try {
  const [port, pid] = readFileSync(portFile, "utf8").trim().split(/\s+/);
  process.kill(Number(pid));
  console.log(JSON.stringify({ stopped: true, port: Number(port), pid: Number(pid) }));
  rmSync(portFile, { force: true });
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
    rmSync(portFile, { force: true });
    console.log(JSON.stringify({ stopped: true, alreadyExited: true }));
  } else {
    console.log(JSON.stringify({ stopped: false, reason: "port file missing or process unavailable" }));
  }
}
