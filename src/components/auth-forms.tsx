"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button } from "./ui";

function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  };
  return { error, loading, run };
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { error, loading, run } = useSubmit();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => {
          await api("/api/auth/login", { body: { email: f.get("email"), password: f.get("password") } });
          const next = params.get("next");
          router.push(next?.startsWith("/app") ? next : "/app");
          router.refresh();
        });
      }}
    >
      <h1 className="title-serif text-2xl">Iniciar sesión</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      <div>
        <label className="label" htmlFor="email">Correo electrónico</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" loading={loading}>Entrar</Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-accent-600 hover:underline">¿Olvidaste la contraseña?</Link>
        <Link href="/register" className="text-accent-600 hover:underline">Crear cuenta</Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const { error, loading, run } = useSubmit();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => {
          await api("/api/auth/register", { body: { name: f.get("name"), email: f.get("email"), password: f.get("password") } });
          router.push("/app");
          router.refresh();
        });
      }}
    >
      <h1 className="title-serif text-2xl">Crear cuenta</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      <div>
        <label className="label" htmlFor="name">Nombre</label>
        <input className="input" id="name" name="name" autoComplete="name" required maxLength={100} />
      </div>
      <div>
        <label className="label" htmlFor="email">Correo electrónico</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <p className="mt-1 text-xs text-muted">Mínimo 10 caracteres.</p>
      </div>
      <Button type="submit" className="w-full" loading={loading}>Crear cuenta</Button>
      <p className="text-xs leading-relaxed text-muted">
        Tus documentos y tu progreso son privados. El contenido que subas se procesa con un proveedor de IA externo para analizarlo y evaluarlo.
      </p>
      <p className="text-center text-sm">
        ¿Ya tienes cuenta? <Link href="/login" className="text-accent-600 hover:underline">Inicia sesión</Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const { error, loading, run } = useSubmit();
  const [sent, setSent] = useState<null | { smtpConfigured: boolean }>(null);
  if (sent)
    return (
      <div className="space-y-3">
        <h1 className="title-serif text-2xl">Revisa tu correo</h1>
        <Alert tone="success">Si existe una cuenta con ese correo, te hemos enviado un enlace válido durante 1 hora.</Alert>
        {!sent.smtpConfigured && (
          <Alert tone="warning">
            El servidor no tiene correo (SMTP) configurado: en este entorno el enlace se escribe en el registro del servidor en lugar de enviarse.
          </Alert>
        )}
        <Link href="/login" className="text-sm text-accent-600 hover:underline">Volver a iniciar sesión</Link>
      </div>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => setSent(await api<{ smtpConfigured: boolean }>("/api/auth/forgot", { body: { email: f.get("email") } })));
      }}
    >
      <h1 className="title-serif text-2xl">Recuperar contraseña</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      <div>
        <label className="label" htmlFor="email">Correo electrónico</label>
        <input className="input" id="email" name="email" type="email" required />
      </div>
      <Button type="submit" className="w-full" loading={loading}>Enviar enlace</Button>
      <Link href="/login" className="block text-center text-sm text-accent-600 hover:underline">Volver</Link>
    </form>
  );
}

export function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { error, loading, run } = useSubmit();
  const [done, setDone] = useState(false);
  const token = params.get("token") ?? "";
  if (done)
    return (
      <div className="space-y-3">
        <Alert tone="success">Contraseña actualizada. Por seguridad se han cerrado todas tus sesiones.</Alert>
        <Button onClick={() => router.push("/login")} className="w-full">Iniciar sesión</Button>
      </div>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("password2")) return void run(async () => { throw new Error("Las contraseñas no coinciden"); });
        void run(async () => {
          await api("/api/auth/reset", { body: { token, password: f.get("password") } });
          setDone(true);
        });
      }}
    >
      <h1 className="title-serif text-2xl">Nueva contraseña</h1>
      {!token && <Alert tone="danger">Falta el token del enlace de recuperación.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <div>
        <label className="label" htmlFor="password">Nueva contraseña</label>
        <input className="input" id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
      </div>
      <div>
        <label className="label" htmlFor="password2">Repite la contraseña</label>
        <input className="input" id="password2" name="password2" type="password" minLength={10} autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" loading={loading} disabled={!token}>Guardar</Button>
    </form>
  );
}
