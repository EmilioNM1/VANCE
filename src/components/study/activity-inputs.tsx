"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ActivityPayload } from "@/lib/types";
import { clsx } from "../ui";

// ───────────────────────────── Respuesta abierta (texto o voz) ─────────────────────────────

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export function OpenAnswer({
  value,
  onChange,
  onVoiceUsed,
  minWords,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onVoiceUsed: () => void;
  minWords?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  const base = useRef("");

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    setSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    return () => rec.current?.stop();
  }, []);

  const toggleVoice = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = document.documentElement.lang === "es" ? "es-ES" : navigator.language;
    r.continuous = true;
    r.interimResults = true;
    base.current = value ? `${value.trim()} ` : "";
    r.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      onChange(base.current + finalText + interim);
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setVoiceError(e.error === "not-allowed" ? "Permiso de micrófono denegado." : "No se pudo usar el reconocimiento de voz.");
      setListening(false);
    };
    rec.current = r;
    setVoiceError(null);
    r.start();
    setListening(true);
    onVoiceUsed();
  };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <div>
      <label htmlFor="answer" className="sr-only">Tu respuesta</label>
      <textarea
        id="answer"
        className="input min-h-44 text-base leading-relaxed"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? "Escribe lo que recuerdes, con tus palabras. No hace falta usar los términos exactos del libro."}
        spellCheck
      />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="tabular-nums">
          {words} palabras{minWords ? ` · se recomiendan al menos ${minWords}` : ""}
        </span>
        {supported && (
          <button
            type="button"
            onClick={toggleVoice}
            disabled={disabled}
            className={clsx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium", listening ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 ")}
            aria-pressed={listening}
          >
            <span className={clsx("h-2 w-2 rounded-full", listening ? "animate-pulse bg-rose-500" : "bg-ink-400")} />
            {listening ? "Detener dictado" : "Responder en voz alta"}
          </button>
        )}
      </div>
      {voiceError && <p className="mt-1 text-xs text-rose-600">{voiceError}</p>}
    </div>
  );
}

// ───────────────────────────── Reconstrucción de procesos ─────────────────────────────

function SortableStep({ id, text, index, total, move, disabled, status }: { id: string; text: string; index: number; total: number; move: (from: number, to: number) => void; disabled?: boolean; status?: "ok" | "bad" }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        "flex items-center gap-2 rounded-xl border bg-surface px-3 py-2.5 text-sm ",
        isDragging ? "z-10 border-accent-400 shadow-lg" : "border-line ",
        status === "ok" && "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30",
        status === "bad" && "border-rose-300 bg-rose-50 dark:bg-rose-950/30",
      )}
    >
      <span className="w-6 shrink-0 text-center font-semibold tabular-nums text-muted">{index + 1}</span>
      <button type="button" className="cursor-grab touch-none rounded p-1 text-muted hover:bg-ink-100 active:cursor-grabbing dark:hover:bg-ink-800" aria-label={`Arrastrar paso: ${text}`} disabled={disabled} {...attributes} {...listeners}>
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden><circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" /><circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" /><circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" /></svg>
      </button>
      <span className="flex-1">{text}</span>
      <span className="flex shrink-0 flex-col">
        <button type="button" className="rounded px-1 text-muted hover:text-ink-800 disabled:opacity-30" onClick={() => move(index, index - 1)} disabled={disabled || index === 0} aria-label={`Subir paso ${index + 1}`}>▲</button>
        <button type="button" className="rounded px-1 text-muted hover:text-ink-800 disabled:opacity-30" onClick={() => move(index, index + 1)} disabled={disabled || index === total - 1} aria-label={`Bajar paso ${index + 1}`}>▼</button>
      </span>
    </li>
  );
}

export function ProcessOrder({ items, order, onChange, disabled, statuses }: { items: NonNullable<ActivityPayload["items"]>; order: string[]; onChange: (o: string[]) => void; disabled?: boolean; statuses?: Record<string, "ok" | "bad"> }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const byId = new Map(items.map((i) => [i.id, i.text]));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    onChange(arrayMove(order, from, to));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2" aria-label="Pasos del proceso">
          {order.map((id, i) => (
            <SortableStep key={id} id={id} text={byId.get(id) ?? id} index={i} total={order.length} move={move} disabled={disabled} status={statuses?.[id]} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

// ───────────────────────────── Completar información ausente ─────────────────────────────

export function Cloze({ segments, values, onChange, disabled }: { segments: NonNullable<ActivityPayload["segments"]>; values: Record<string, string>; onChange: (v: Record<string, string>) => void; disabled?: boolean }) {
  let n = 0;
  return (
    <p className="text-base leading-loose">
      {segments.map((s, i) =>
        s.type === "text" ? (
          <span key={i}>{s.text}</span>
        ) : (
          <input
            key={i}
            aria-label={`Hueco ${++n}`}
            className="mx-1 inline-block rounded-md border-b-2 border-accent-400 bg-accent-50 px-2 py-0.5 text-center text-base focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:bg-accent-900/30"
            style={{ width: `${Math.min(18, Math.max(6, s.length + 2))}ch` }}
            value={values[s.id] ?? ""}
            onChange={(e) => onChange({ ...values, [s.id]: e.target.value })}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
        ),
      )}
    </p>
  );
}

// ───────────────────────────── Reconocimiento (complementario) ─────────────────────────────

export function Recognition({ options, value, onChange, disabled }: { options: NonNullable<ActivityPayload["options"]>; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">Opciones</legend>
      {options.map((o) => (
        <label key={o.id} className={clsx("flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition", value === o.id ? "border-accent-500 bg-accent-50 dark:bg-accent-900/30" : "border-line hover:border-ink-300 ")}>
          <input type="radio" name="recognition" value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} disabled={disabled} />
          {o.text}
        </label>
      ))}
    </fieldset>
  );
}

// ───────────────────────────── Confianza declarada ─────────────────────────────

const CONF = ["Lo he adivinado", "Dudoso", "Bastante seguro", "Seguro"];

export function ConfidencePicker({ value, onChange, disabled }: { value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-muted">¿Qué seguridad tienes? (ayuda a detectar aciertos por casualidad)</legend>
      <div className="flex flex-wrap gap-1.5">
        {CONF.map((label, i) => (
          <button
            type="button"
            key={label}
            onClick={() => onChange(i + 1)}
            disabled={disabled}
            aria-pressed={value === i + 1}
            className={clsx("rounded-full border px-3 py-1 text-xs", value === i + 1 ? "border-accent-500 bg-accent-600 text-white" : "border-line text-ink-600 hover:border-ink-300  ")}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Completar un esquema ─────────────────────────────


function BankChip({ id, text, disabled }: { id: string; text: string; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `label:${id}`, disabled });
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{ transform: CSS.Translate.toString(transform) }}
      className={clsx("touch-none rounded-lg border border-accent-300 bg-accent-50 px-3 py-1.5 text-left text-sm text-accent-900 dark:border-accent-700 dark:bg-accent-900/40 dark:text-accent-100", isDragging && "z-20 shadow-float")}
      {...attributes}
      {...listeners}
    >
      {text}
    </button>
  );
}

function Slot({ nodeId, index, label, options, value, onChange, disabled, status }: { nodeId: string; index: number; label: string | null; options: { id: string; text: string }[]; value?: string; onChange: (labelId: string) => void; disabled?: boolean; status?: "ok" | "bad" }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${nodeId}`, disabled: !!label || disabled });
  if (label)
    return (
      <div className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
        <span className="mr-2 text-xs font-semibold tabular-nums text-muted">{index + 1}</span>
        {label}
      </div>
    );
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "rounded-lg border-2 border-dashed px-3 py-2 text-sm transition-colors",
        isOver ? "border-accent-500 bg-accent-50 dark:bg-accent-900/30" : "border-line",
        status === "ok" && "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
        status === "bad" && "border-rose-400 bg-rose-50 dark:bg-rose-950/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tabular-nums text-muted">{index + 1}</span>
        <label className="sr-only" htmlFor={`slot-${nodeId}`}>Hueco {index + 1}</label>
        <select id={`slot-${nodeId}`} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none">
          <option value="">Arrastra o elige una etiqueta…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.text}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function DiagramBoard({
  diagram,
  value,
  onChange,
  disabled,
  wrongNodes,
}: {
  diagram: NonNullable<ActivityPayload["diagram"]>;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  disabled?: boolean;
  wrongNodes?: string[];
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const used = new Set(Object.values(value));
  const bank = diagram.bank.filter((b) => !used.has(b.id));
  const onDragEnd = (e: DragEndEvent) => {
    const labelId = String(e.active.id).replace("label:", "");
    const over = e.over ? String(e.over.id).replace("slot:", "") : null;
    if (!over) return;
    const next = Object.fromEntries(Object.entries(value).filter(([, l]) => l !== labelId));
    next[over] = labelId;
    onChange(next);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid gap-5 md:grid-cols-[1fr_14rem]">
        <ol className={clsx("space-y-1", diagram.layout === "hub" && "grid gap-2 sm:grid-cols-2 sm:space-y-0")} aria-label="Esquema">
          {diagram.nodes.map((n, i) => (
            <li key={n.id}>
              <Slot
                nodeId={n.id}
                index={i}
                label={n.label}
                options={diagram.bank}
                value={value[n.id]}
                disabled={disabled}
                status={wrongNodes ? (n.label ? undefined : wrongNodes.includes(n.id) ? "bad" : "ok") : undefined}
                onChange={(labelId) => {
                  const next = Object.fromEntries(Object.entries(value).filter(([k, l]) => l !== labelId && k !== n.id));
                  if (labelId) next[n.id] = labelId;
                  onChange(next);
                }}
              />
              {diagram.layout === "chain" && i < diagram.nodes.length - 1 && (
                <div className="flex justify-center py-0.5 text-muted" aria-hidden>
                  ↓
                </div>
              )}
            </li>
          ))}
        </ol>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Etiquetas</p>
          <div className="flex flex-wrap gap-2 md:flex-col">
            {bank.length === 0 ? <p className="text-sm text-muted">Todas colocadas.</p> : bank.map((b) => <BankChip key={b.id} id={b.id} text={b.text} disabled={disabled} />)}
          </div>
        </div>
      </div>
    </DndContext>
  );
}
