"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteDoc } from "@/lib/types";

export type SaveStatus = "saved" | "dirty" | "saving" | "offline" | "error" | "conflict";

export interface ServerPage {
  version: number;
  title: string;
  content: NoteDoc;
  updatedAt: string;
}

interface Options {
  pageId: string;
  initialVersion: number;
  getSnapshot: () => { content: NoteDoc; title: string };
  onConflict: (server: ServerPage) => void;
  onSaved?: (r: { version: number; contentHash: string; wordCount: number; lastAnalyzedHash: string | null }) => void;
}

const DEBOUNCE_MS = 1200;
const MAX_WAIT_MS = 8000;
export const backupKey = (pageId: string) => `vance-page-backup-${pageId}`;

/**
 * Guardado automático independiente de la IA.
 * - Nunca muestra «Guardado» hasta que el servidor confirma la escritura.
 * - Copia local de seguridad mientras hay cambios sin confirmar (cierre, caída de red).
 * - Reintentos con espera creciente y al recuperar la conexión.
 * - Control de versiones: si otro dispositivo guardó antes, se notifica el conflicto.
 */
export function useAutosave({ pageId, initialVersion, getSnapshot, onConflict, onSaved }: Options) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const version = useRef(initialVersion);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstDirtyAt = useRef<number | null>(null);
  const retryDelay = useRef(2000);
  const statusRef = useRef<SaveStatus>("saved");
  const snapshotRef = useRef(getSnapshot);
  snapshotRef.current = getSnapshot;
  const conflictRef = useRef(onConflict);
  conflictRef.current = onConflict;
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  const set = (s: SaveStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const writeBackup = useCallback(() => {
    try {
      const snap = snapshotRef.current();
      localStorage.setItem(backupKey(pageId), JSON.stringify({ baseVersion: version.current, ...snap, at: Date.now() }));
    } catch {
      /* almacenamiento lleno o no disponible */
    }
  }, [pageId]);

  const saveNow = useCallback(
    async (opts: { force?: boolean; keepalive?: boolean } = {}): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (statusRef.current === "conflict" && !opts.force) return false;
      if (inFlight.current) {
        pending.current = true;
        return false;
      }
      inFlight.current = true;
      pending.current = false;
      set("saving");
      const snap = snapshotRef.current();
      try {
        const res = await fetch(`/api/notes/pages/${pageId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseVersion: version.current, content: snap.content, title: snap.title, force: opts.force }),
          keepalive: opts.keepalive,
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.code === "VERSION_CONFLICT") {
          set("conflict");
          conflictRef.current(data.server as ServerPage);
          return false;
        }
        if (!res.ok) {
          if (res.status === 400) {
            // Contenido rechazado por validación: no se reintenta en bucle
            set("error");
            return false;
          }
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        version.current = data.version;
        retryDelay.current = 2000;
        firstDirtyAt.current = null;
        setLastSavedAt(new Date());
        savedRef.current?.(data);
        if (pending.current) {
          inFlight.current = false;
          set("dirty");
          return saveNow();
        }
        try {
          localStorage.removeItem(backupKey(pageId));
        } catch {
          /* ignorar */
        }
        set("saved");
        return true;
      } catch {
        set(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
        writeBackup();
        const delay = retryDelay.current;
        retryDelay.current = Math.min(30_000, delay * 2);
        timer.current = setTimeout(() => void saveNow(), delay);
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [pageId, writeBackup],
  );

  const markDirty = useCallback(() => {
    if (statusRef.current === "conflict") return;
    set(statusRef.current === "offline" ? "offline" : "dirty");
    writeBackup();
    firstDirtyAt.current ??= Date.now();
    if (timer.current) clearTimeout(timer.current);
    const waited = Date.now() - firstDirtyAt.current;
    timer.current = setTimeout(() => void saveNow(), waited > MAX_WAIT_MS ? 0 : DEBOUNCE_MS);
  }, [saveNow, writeBackup]);

  const setVersion = useCallback((v: number) => {
    version.current = v;
  }, []);

  const resolveConflict = useCallback(
    (choice: "mine" | "theirs", server?: ServerPage) => {
      if (choice === "theirs" && server) {
        version.current = server.version;
        try {
          localStorage.removeItem(backupKey(pageId));
        } catch {
          /* ignorar */
        }
        set("saved");
      } else {
        set("dirty");
        void saveNow({ force: true });
      }
    },
    [pageId, saveNow],
  );

  useEffect(() => {
    const online = () => {
      if (statusRef.current === "offline" || statusRef.current === "error") void saveNow();
    };
    const hide = () => {
      if (document.visibilityState === "hidden" && statusRef.current === "dirty") void saveNow({ keepalive: true });
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (statusRef.current !== "saved") {
        writeBackup();
        e.preventDefault();
      }
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [saveNow, writeBackup]);

  // Al salir de la página por navegación interna: se envía la última copia local pendiente
  useEffect(
    () => () => {
      if (statusRef.current === "saved" || statusRef.current === "conflict" || inFlight.current) return;
      try {
        const raw = localStorage.getItem(backupKey(pageId));
        if (!raw) return;
        const b = JSON.parse(raw) as { content: unknown; title: string };
        void fetch(`/api/notes/pages/${pageId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseVersion: version.current, content: b.content, title: b.title }),
          keepalive: true,
        }).then((r) => r.ok && localStorage.removeItem(backupKey(pageId)));
      } catch {
        /* la copia local permitirá recuperarlo al volver */
      }
    },
    [pageId],
  );

  return { status, lastSavedAt, saveNow, markDirty, setVersion, resolveConflict, versionRef: version };
}
