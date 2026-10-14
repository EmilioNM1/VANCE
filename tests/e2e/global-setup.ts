import { execSync } from "node:child_process";

/** Restablece la cuenta y la biblioteca de demostración antes de las pruebas E2E. */
export default function globalSetup() {
  execSync("npm run -s db:seed-demo", { stdio: "inherit" });
}
