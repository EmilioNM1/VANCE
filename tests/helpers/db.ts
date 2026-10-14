import { randomUUID } from "node:crypto";
import { registerUser } from "@/server/auth/service";

export async function makeUser(name = "Test") {
  return registerUser({ name, email: `${randomUUID()}@test.local`, password: "contraseña-segura-123" });
}
