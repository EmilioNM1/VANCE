import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Correo electrónico no válido").max(254);
export const passwordSchema = z
  .string()
  .min(10, "La contraseña debe tener al menos 10 caracteres")
  .max(200, "La contraseña es demasiado larga");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Indica tu nombre").max(100),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
