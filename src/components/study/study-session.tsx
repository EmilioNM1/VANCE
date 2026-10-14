"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { ACTIVITY_LABELS, type EvaluationResult } from "@/lib/types";
import type { ItemView, SessionView } from "@/server/study/session";
import { Alert, Badge, Button, ButtonLink, Card, Progress, Spinner, clsx, relativeDue } from "../ui";
import { Cloze, ConfidencePicker, OpenAnswer, ProcessOrder, Recognition } from "./activity-inputs";

type Eval = EvaluationResult & { provisional: boolean; method: string };
interface SubmitResult {
  state: string;
  evaluation: Eval;
  memory: { grade: number; state: string; dueAt: string | null; scheduledDays: number } | null;
}

const LEVEL_LABEL = ["", "Pista general", "Pista sobre el concepto", "Orientación sobre el mecanismo", "Explicación completa"];
const GRADE_LABEL = ["", "Olvidado: volverá pronto", "Difícil", "Bien", "Fácil"];

export function StudySession({ sessionId }: { sessionId: string }) {
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ item: ItemView; result: SubmitResult } | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api<SessionView>(`/api/study/sessions/${sessionId}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la sesión");
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!view)
    return (
      <div className="flex items-center gap-2 text-ink-500">
        <Spinner /> Cargando sesión…
      </div>
    );

  const progress = view.total ? (view.done / view.total) * 100 : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/app" className="text-sm text-ink-500 hover:text-ink-800">✕ Salir</Link>
        <Progress value={progress} className="flex-1" label="Progreso de la sesión" />
        <span className="text-sm tabular-nums text-ink-500">{view.done}/{view.total}</span>
      </div>
      {done ? (
        <ResultPanel
          item={done.item}
          result={done.result}
          onNext={async () => {
            setDone(null);
            await load();
          }}
        />
      ) : view.current ? (
        <ItemRunner key={`${view.current.itemId}-${view.current.state}-${view.current.attemptsCount}-${view.current.hintLevel}`} item={view.current} reload={load} onDone={(item, result) => setDone({ item, result })} />
      ) : (
        <SessionSummary view={view} />
      )}
    </div>
  );
}

function ItemRunner({ item, reload, onDone }: { item: ItemView; reload: () => Promise<void>; onDone: (item: ItemView, r: SubmitResult) => void }) {
  const a = item.activity;
  const storageKey = `vance-draft-${item.itemId}`;
  const postExplanation = item.state === "AWAITING_POST_EXPLANATION";
  const [text, setText] = useState("");
  const [order, setOrder] = useState<string[]>(a.payload.items?.map((i) => i.id) ?? []);
  const [justification, setJustification] = useState("");
  const [blanks, setBlanks] = useState<Record<string, string>>({});
  const [option, setOption] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState<null | "submit" | "hint" | "skip">(null);
  const [error, setError] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(postExplanation);

  // Borrador local (por si se cierra la pestaña) — nunca sustituye al estado del servidor
  useEffect(() => {
    if (postExplanation) return;
    try {
      const d = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { text?: string; order?: string[]; blanks?: Record<string, string> } | null;
      if (d?.text) setText(d.text);
      if (d?.order && d.order.length === order.length) setOrder(d.order);
      if (d?.blanks) setBlanks(d.blanks);
    } catch {
      /* sin almacenamiento */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ text, order, blanks }));
    } catch {
      /* ignorar */
    }
  }, [storageKey, text, order, blanks]);

  const isOpen = !["PROCESS_ORDER", "CLOZE", "RECOGNITION"].includes(a.type);
  const response = a.type === "PROCESS_ORDER" ? { order, justification: justification || undefined } : a.type === "CLOZE" ? { blanks } : a.type === "RECOGNITION" ? { optionId: option } : { text };
  const canSubmit = a.type === "RECOGNITION" ? !!option : a.type === "CLOZE" ? Object.values(blanks).some((v) => v.trim()) : a.type === "PROCESS_ORDER" ? true : text.trim().length > 0;

  const submit = async () => {
    setBusy("submit");
    setError(null);
    try {
      const r = await api<SubmitResult>(`/api/study/items/${item.itemId}/submit`, {
        body: { response, confidence: item.attemptsCount === 0 ? confidence : null, inputMode: voice ? "VOICE" : isOpen ? "TEXT" : "INTERACTIVE" },
      });
      if (r.state === "DONE") {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* ignorar */
        }
        onDone(item, r);
      } else await reload();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "CONFLICT" ? "Esta actividad ya se había respondido; recargando…" : e instanceof Error ? e.message : "Error");
      if (e instanceof ApiError && e.code === "CONFLICT") setTimeout(() => void reload(), 800);
    } finally {
      setBusy(null);
    }
  };
  const hint = async () => {
    setBusy("hint");
    setError(null);
    try {
      await api(`/api/study/items/${item.itemId}/hint`, { method: "POST" });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(null);
    }
  };
  const skip = async () => {
    if (!confirm("¿Saltar esta actividad? No contará para tu programación de repasos.")) return;
    setBusy("skip");
    await api(`/api/study/items/${item.itemId}/skip`, { method: "POST" }).catch(() => {});
    await reload();
  };

  const ev = item.lastEvaluation;
  const orderStatuses =
    a.type === "PROCESS_ORDER" && ev?.details && !postExplanation
      ? Object.fromEntries(((ev.details.misplaced as string[]) ?? []).map((id) => [id, "bad" as const]))
      : undefined;

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{ACTIVITY_LABELS[a.type]}</Badge>
        <Badge>{item.reason}</Badge>
        {item.noHints && <Badge tone="warning">Sin pistas</Badge>}
        {a.conceptName && <span className="text-xs text-ink-500">{a.conceptName} · {a.documentTitle}</span>}
      </div>

      <Card>
        <h1 className="whitespace-pre-line text-lg font-semibold leading-snug">{a.prompt}</h1>
        {a.payload.scenario && <p className="mt-3 rounded-xl bg-ink-50 p-4 text-sm leading-relaxed dark:bg-ink-800/60">{a.payload.scenario}</p>}
        {a.payload.instructions && <p className="mt-2 text-xs text-ink-500">{a.payload.instructions}</p>}
      </Card>

      {postExplanation && (
        <Card className="border-accent-200 dark:border-accent-900">
          {showExplanation ? (
            <>
              <h2 className="mb-2 font-semibold">Explicación</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed">{item.explanation}</p>
              <Button className="mt-4" onClick={() => setShowExplanation(false)}>He terminado de leer: ocultarla y recordarlo yo</Button>
            </>
          ) : (
            <Alert tone="info">Ahora, sin mirar la explicación, vuelve a recuperarlo de memoria. Este paso es el que fija la corrección.</Alert>
          )}
        </Card>
      )}

      {ev && !postExplanation && <FeedbackBox ev={ev} attempt={item.attemptsCount} />}

      {item.hints.length > 0 && !postExplanation && (
        <Card className="space-y-2">
          {item.hints.map((h) => (
            <div key={h.level} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <span className="font-medium">{LEVEL_LABEL[h.level]}: </span>
              {h.text}
            </div>
          ))}
        </Card>
      )}

      {!(postExplanation && showExplanation) && (
        <Card>
          {isOpen && <OpenAnswer value={text} onChange={setText} onVoiceUsed={() => setVoice(true)} minWords={a.payload.minWords} disabled={!!busy} placeholder={postExplanation ? "Explícalo de nuevo con tus palabras, sin mirar." : undefined} />}
          {a.type === "PROCESS_ORDER" && (
            <>
              <ProcessOrder items={a.payload.items ?? []} order={order} onChange={setOrder} disabled={!!busy} statuses={orderStatuses} />
              {a.payload.askJustification && (
                <div className="mt-4">
                  <label className="label" htmlFor="justification">Explica por qué cada paso lleva al siguiente (opcional, recomendado)</label>
                  <textarea id="justification" className="input min-h-24" value={justification} onChange={(e) => setJustification(e.target.value)} disabled={!!busy} />
                </div>
              )}
            </>
          )}
          {a.type === "CLOZE" && <Cloze segments={a.payload.segments ?? []} values={blanks} onChange={setBlanks} disabled={!!busy} />}
          {a.type === "RECOGNITION" && <Recognition options={a.payload.options ?? []} value={option} onChange={setOption} disabled={!!busy} />}

          {item.attemptsCount === 0 && !postExplanation && (
            <div className="mt-4">
              <ConfidencePicker value={confidence} onChange={setConfidence} disabled={!!busy} />
            </div>
          )}
          {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={submit} loading={busy === "submit"} disabled={!canSubmit || !!busy}>
              {busy === "submit" && isOpen ? "Evaluando…" : item.attemptsCount === 0 ? "Comprobar" : "Comprobar de nuevo"}
            </Button>
            {!item.noHints && !postExplanation && item.hintLevel < item.maxHintLevel && (
              <Button variant="secondary" onClick={hint} loading={busy === "hint"} disabled={!!busy}>
                {item.hintLevel === 0 ? "No lo recuerdo: dame una pista" : item.hintLevel + 1 === 4 ? "Ver la explicación completa" : "Necesito más ayuda"}
              </Button>
            )}
            <Button variant="ghost" onClick={skip} disabled={!!busy}>Saltar</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function FeedbackBox({ ev, attempt }: { ev: Eval; attempt: number }) {
  const tone = ev.verdict === "CORRECT" ? "success" : ev.verdict === "PARTIAL" || ev.verdict === "AMBIGUOUS" ? "warning" : "danger";
  const title = { CORRECT: "Correcto", PARTIAL: "Parcialmente correcto", INCORRECT: "Todavía no", AMBIGUOUS: "Respuesta defendible: hay ambigüedad" }[ev.verdict];
  return (
    <Alert tone={tone} title={`${title} · ${Math.round(ev.score * 100)}%${attempt > 1 ? ` (intento ${attempt})` : ""}`}>
      <p>{ev.feedback}</p>
      {ev.ambiguityNote && <p className="mt-1 italic">{ev.ambiguityNote}</p>}
      {ev.correct.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {ev.correct.map((c, i) => <li key={i}>✓ {c}</li>)}
        </ul>
      )}
      {ev.incorrect.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {ev.incorrect.map((c, i) => <li key={i}>✗ {c.description}</li>)}
        </ul>
      )}
      {ev.missing.length > 0 && <p className="mt-2">Te falta recuperar: {ev.missing.join(" · ")}</p>}
      <p className="mt-2 text-xs opacity-80">Inténtalo de nuevo antes de ver la solución: recuperar con esfuerzo es lo que fortalece el recuerdo.</p>
    </Alert>
  );
}

function ResultPanel({ item, result, onNext }: { item: ItemView; result: SubmitResult; onNext: () => void }) {
  const ev = result.evaluation;
  const tone = ev.verdict === "CORRECT" ? "success" : ev.verdict === "INCORRECT" ? "danger" : "warning";
  return (
    <div className="animate-fade-in space-y-4">
      <Alert tone={tone} title={`${ev.verdict === "CORRECT" ? "¡Bien recuperado!" : ev.verdict === "AMBIGUOUS" ? "Respuesta defendible" : "Actividad completada"} · ${Math.round(ev.score * 100)}%`}>
        {ev.provisional && <p className="mb-1 font-medium">Evaluación provisional: se reevaluará con IA cuando esté disponible.</p>}
        <p>{ev.feedback}</p>
        {ev.ambiguityNote && <p className="mt-1 italic">{ev.ambiguityNote}</p>}
      </Alert>
      <Card>
        <p className="text-sm text-ink-500">{ACTIVITY_LABELS[item.activity.type]} · {item.activity.conceptName ?? "concepto"}</p>
        <h2 className="mt-1 whitespace-pre-line font-semibold">{item.activity.prompt}</h2>
        {ev.elements.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {ev.elements.map((e) => (
              <li key={e.id} className={clsx("rounded-lg px-3 py-1.5", e.status === "PRESENT" ? "bg-emerald-50 dark:bg-emerald-950/30" : e.status === "PARTIAL" ? "bg-amber-50 dark:bg-amber-950/30" : "bg-rose-50 dark:bg-rose-950/30")}>
                {e.status === "PRESENT" ? "✓" : e.status === "PARTIAL" ? "◐" : "✗"} {e.label}
                {e.note && <span className="block text-xs text-ink-500">{e.note}</span>}
              </li>
            ))}
          </ul>
        )}
        {ev.incorrect.length > 0 && (
          <div className="mt-3 text-sm">
            <p className="font-medium">A corregir</p>
            <ul className="mt-1 space-y-1">
              {ev.incorrect.map((c, i) => (
                <li key={i}>✗ {c.description}{c.explanation && <span className="block text-xs text-ink-500">{c.explanation}</span>}</li>
              ))}
            </ul>
          </div>
        )}
        {ev.explanation && (
          <div className="mt-4 rounded-xl bg-ink-50 p-4 text-sm leading-relaxed dark:bg-ink-800/60">
            <p className="mb-1 font-medium">Explicación</p>
            <p className="whitespace-pre-line">{ev.explanation}</p>
          </div>
        )}
        {ev.references.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-500">Fuente en tu material ({ev.references.length})</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {ev.references.map((r) => (
                <li key={r.claimId} className="border-l-2 border-accent-200 pl-2">{r.text}{r.page ? <span className="text-ink-500"> — pág. {r.page}</span> : null}</li>
              ))}
            </ul>
          </details>
        )}
        {ev.nextRecommendation && <p className="mt-3 text-xs text-ink-500">Siguiente paso sugerido: {ev.nextRecommendation}</p>}
      </Card>
      {result.memory && (
        <p className="text-center text-sm text-ink-500">
          {GRADE_LABEL[result.memory.grade]} · próximo repaso {relativeDue(result.memory.dueAt)}
        </p>
      )}
      <div className="flex justify-center">
        <Button onClick={onNext} className="px-8">Siguiente</Button>
      </div>
    </div>
  );
}

function SessionSummary({ view }: { view: SessionView }) {
  const done = view.summary.filter((s) => s.state === "DONE");
  const avgFirst = done.length ? done.reduce((a, s) => a + (s.firstScore ?? 0), 0) / done.length : null;
  return (
    <div className="animate-fade-in space-y-4">
      <Card className="text-center">
        <h1 className="text-xl font-semibold">Sesión completada</h1>
        <p className="mt-1 text-sm text-ink-500">
          {done.length} actividades · recuperación en el primer intento: {avgFirst === null ? "—" : `${Math.round(avgFirst * 100)}%`}
        </p>
        <p className="mt-2 text-xs text-ink-500">Lo que hoy te costó volverá antes; lo que recordaste bien se espaciará más.</p>
      </Card>
      <Card>
        <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
          {view.summary.map((s) => (
            <li key={s.itemId} className="flex items-center justify-between gap-3 py-2">
              <span>
                {s.conceptName} <span className="text-xs text-ink-500">· {ACTIVITY_LABELS[s.type]}</span>
              </span>
              <span className="tabular-nums text-ink-500">
                {s.state === "SKIPPED" ? "saltada" : s.firstScore === null ? "—" : `${Math.round(s.firstScore * 100)}% → ${Math.round((s.finalScore ?? 0) * 100)}%`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex justify-center gap-2">
        <ButtonLink href="/app">Volver al panel</ButtonLink>
        <ButtonLink href="/app/reviews" variant="secondary">Ver agenda</ButtonLink>
      </div>
    </div>
  );
}
