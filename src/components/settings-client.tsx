"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { UserSettings } from "@/lib/types";
import { Alert, Button } from "./ui";

function useAction() {
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ tone: "success", text: await fn() });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  };
  return { msg, busy, run };
}

export function ProfileForm({ name }: { name: string }) {
  const router = useRouter();
  const { msg, busy, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => {
          await api("/api/account", { method: "PATCH", body: { name: f.get("name") } });
          router.refresh();
          return "Perfil actualizado.";
        });
      }}
    >
      <div>
        <label className="label" htmlFor="name">Nombre</label>
        <input id="name" name="name" className="input" defaultValue={name} required maxLength={100} />
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Button type="submit" loading={busy}>Guardar</Button>
    </form>
  );
}

export function PasswordForm() {
  const { msg, busy, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        void run(async () => {
          await api("/api/account/password", { body: { current: f.get("current"), next: f.get("next") } });
          form.reset();
          return "Contraseña cambiada.";
        });
      }}
    >
      <div>
        <label className="label" htmlFor="current">Contraseña actual</label>
        <input id="current" name="current" type="password" className="input" autoComplete="current-password" required />
      </div>
      <div>
        <label className="label" htmlFor="next">Nueva contraseña</label>
        <input id="next" name="next" type="password" className="input" autoComplete="new-password" minLength={10} required />
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Button type="submit" loading={busy}>Cambiar contraseña</Button>
    </form>
  );
}

export function LearningSettingsForm({ settings }: { settings: UserSettings }) {
  const router = useRouter();
  const { msg, busy, run } = useAction();
  const iv = settings.initialIntervalsDays;
  const num = (f: FormData, k: string) => Number(f.get(k));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => {
          await api("/api/account/settings", {
            method: "PATCH",
            body: {
              initialIntervalsDays: { again: num(f, "again") / 1440, hard: num(f, "hard"), good: num(f, "good"), easy: num(f, "easy") },
              desiredRetention: num(f, "retention") / 100,
              maxHintLevel: num(f, "maxHint"),
              retriesBeforeExplanation: num(f, "retries"),
              dailyNewConcepts: num(f, "newPerDay"),
              dailyReviewGoal: num(f, "dailyGoal"),
              weeklyMinutesGoal: num(f, "weeklyGoal"),
            },
          });
          router.refresh();
          return "Preferencias guardadas.";
        });
      }}
    >
      <fieldset>
        <legend className="label">Intervalos iniciales tras la primera recuperación</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["again", "Olvidado (min)", Math.round(iv.again * 1440), 5, 1440, 1],
            ["hard", "Difícil (días)", iv.hard, 0.1, 10, 0.1],
            ["good", "Bien (días)", iv.good, 0.5, 30, 0.5],
            ["easy", "Fácil (días)", iv.easy, 1, 60, 0.5],
          ].map(([k, label, v, min, max, step]) => (
            <div key={k as string}>
              <label className="text-xs text-muted" htmlFor={k as string}>{label}</label>
              <input id={k as string} name={k as string} type="number" className="input" defaultValue={v as number} min={min as number} max={max as number} step={step as number} required />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">A partir de ahí, los intervalos se adaptan a tus resultados reales.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="retention">Retención objetivo (%)</label>
          <input id="retention" name="retention" type="number" className="input" defaultValue={Math.round(settings.desiredRetention * 100)} min={70} max={97} required />
        </div>
        <div>
          <label className="label" htmlFor="maxHint">Ayuda máxima</label>
          <select id="maxHint" name="maxHint" className="input" defaultValue={settings.maxHintLevel}>
            <option value={1}>Nivel 1: pista general</option>
            <option value={2}>Nivel 2: concepto relevante</option>
            <option value={3}>Nivel 3: mecanismo o pasos</option>
            <option value={4}>Nivel 4: explicación completa</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="retries">Reintentos antes de la explicación</label>
          <input id="retries" name="retries" type="number" className="input" defaultValue={settings.retriesBeforeExplanation} min={0} max={4} required />
        </div>
        <div>
          <label className="label" htmlFor="newPerDay">Conceptos nuevos por día</label>
          <input id="newPerDay" name="newPerDay" type="number" className="input" defaultValue={settings.dailyNewConcepts} min={0} max={100} required />
        </div>
        <div>
          <label className="label" htmlFor="dailyGoal">Objetivo diario (actividades)</label>
          <input id="dailyGoal" name="dailyGoal" type="number" className="input" defaultValue={settings.dailyReviewGoal} min={1} max={500} required />
        </div>
        <div>
          <label className="label" htmlFor="weeklyGoal">Objetivo semanal (minutos)</label>
          <input id="weeklyGoal" name="weeklyGoal" type="number" className="input" defaultValue={settings.weeklyMinutesGoal} min={10} max={5000} required />
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Button type="submit" loading={busy}>Guardar preferencias</Button>
    </form>
  );
}

export function DeleteAccountForm() {
  const router = useRouter();
  const { msg, busy, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm("Esta acción es irreversible: se borrarán tu cuenta, tus documentos y todo tu progreso. ¿Continuar?")) return;
        const f = new FormData(e.currentTarget);
        void run(async () => {
          await api("/api/account/delete", { body: { password: f.get("password") } });
          router.push("/");
          router.refresh();
          return "Cuenta eliminada.";
        });
      }}
    >
      <div>
        <label className="label" htmlFor="del-pw">Confirma con tu contraseña</label>
        <input id="del-pw" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Button type="submit" variant="danger" loading={busy}>Eliminar mi cuenta y mis datos</Button>
    </form>
  );
}
