/**
 * DATOS DE DEMOSTRACIÓN — claramente identificados (is_demo = true, generated_by = 'DEMO').
 * Crean una biblioteca con un capítulo breve de fisiología muscular, su conocimiento y
 * actividades, para poder probar el flujo de estudio sin clave de IA.
 * NO sustituyen al procesamiento real: las afirmaciones figuran como "aprobadas", no verificadas.
 *
 * Uso:  npm run db:seed-demo                 → crea/actualiza el usuario demo@vance.local
 *       npm run db:seed-demo -- tu@correo    → añade la biblioteca demo a una cuenta existente
 */
import { eq } from "drizzle-orm";
import { getDb, getPool, withUser } from "./client";
import { activities, chunks, claims, conceptClaims, conceptRelations, concepts, documents, libraries, sections, users } from "./schema";
import { buildCloze, buildProcessOrder, buildRecognition } from "../server/activities/generate";
import { hashPassword } from "../server/auth/password";
import { DEFAULT_SETTINGS, type Rubric } from "../lib/types";

const TEXT: { section: string; page: number; paragraphs: string[] }[] = [
  {
    section: "Unión neuromuscular",
    page: 1,
    paragraphs: [
      "La neurona motora libera acetilcolina en la unión neuromuscular. La acetilcolina se une a receptores nicotínicos de la placa motora y genera un potencial de placa que desencadena un potencial de acción en la fibra muscular.",
    ],
  },
  {
    section: "Acoplamiento excitación-contracción",
    page: 2,
    paragraphs: [
      "El potencial de acción se propaga por el sarcolema y penetra en la fibra a través de los túbulos T. En los túbulos T, el receptor de dihidropiridina (DHPR) detecta el cambio de voltaje y activa mecánicamente al receptor de rianodina (RyR1) del retículo sarcoplásmico.",
      "La apertura de RyR1 libera calcio desde el retículo sarcoplásmico al citosol. El calcio se une a la troponina C, lo que desplaza la tropomiosina y expone los sitios de unión para la miosina en la actina.",
      "Las cabezas de miosina se unen a la actina y, al liberar ADP y fosfato, producen el golpe de fuerza que desliza los filamentos. La unión de ATP a la miosina permite que se separe de la actina.",
      "La relajación ocurre cuando la bomba SERCA recapta el calcio hacia el retículo sarcoplásmico y la tropomiosina vuelve a cubrir los sitios de unión de la actina.",
    ],
  },
];

const CLAIMS: { key: string; text: string; p: number; kind: "MECHANISM" | "DEFINITION" | "PROCESS_STEP" | "FACT" }[] = [
  { key: "ach", text: "La neurona motora libera acetilcolina en la unión neuromuscular.", p: 0, kind: "PROCESS_STEP" },
  { key: "nic", text: "La acetilcolina se une a receptores nicotínicos de la placa motora y genera un potencial de placa que desencadena un potencial de acción en la fibra muscular.", p: 0, kind: "MECHANISM" },
  { key: "tt", text: "El potencial de acción se propaga por el sarcolema y penetra en la fibra a través de los túbulos T.", p: 1, kind: "PROCESS_STEP" },
  { key: "dhpr", text: "El receptor de dihidropiridina (DHPR) detecta el cambio de voltaje y activa mecánicamente al receptor de rianodina (RyR1) del retículo sarcoplásmico.", p: 1, kind: "MECHANISM" },
  { key: "ryr", text: "La apertura de RyR1 libera calcio desde el retículo sarcoplásmico al citosol.", p: 2, kind: "PROCESS_STEP" },
  { key: "tnc", text: "El calcio se une a la troponina C, lo que desplaza la tropomiosina y expone los sitios de unión para la miosina en la actina.", p: 2, kind: "MECHANISM" },
  { key: "cross", text: "Las cabezas de miosina se unen a la actina y, al liberar ADP y fosfato, producen el golpe de fuerza que desliza los filamentos.", p: 3, kind: "PROCESS_STEP" },
  { key: "atp", text: "La unión de ATP a la miosina permite que se separe de la actina.", p: 3, kind: "FACT" },
  { key: "serca", text: "La relajación ocurre cuando la bomba SERCA recapta el calcio hacia el retículo sarcoplásmico y la tropomiosina vuelve a cubrir los sitios de unión de la actina.", p: 4, kind: "MECHANISM" },
];

export async function seedDemo(userId: string) {
  return withUser(userId, async (tx) => {
    const existing = await tx.select().from(libraries).where(eq(libraries.isDemo, true));
    for (const l of existing) await tx.delete(libraries).where(eq(libraries.id, l.id));

    const [lib] = await tx.insert(libraries).values({ userId, name: "Demostración: Fisiología", subject: "Datos de demostración", isDemo: true }).returning();
    const [doc] = await tx
      .insert(documents)
      .values({
        userId,
        libraryId: lib!.id,
        title: "Contracción del músculo esquelético (demo)",
        topic: "Fisiología muscular",
        originalFilename: "demo-contraccion.txt",
        mimeType: "text/plain",
        sizeBytes: 0,
        sha256: "demo",
        storageKey: "demo/none",
        status: "READY",
        statusDetail: "Documento de demostración generado por script (sin procesamiento de IA).",
        extractionMethod: "text",
        pageCount: 2,
        rightsConfirmedAt: new Date(),
        auditCompletedAt: new Date(),
        knowledgeBuiltAt: new Date(),
        isDemo: true,
        warnings: ["Datos de demostración: las afirmaciones no se han contrastado con fuentes externas."],
      })
      .returning();
    const documentId = doc!.id;

    const chunkIds: string[] = [];
    let ord = 0;
    for (let s = 0; s < TEXT.length; s++) {
      const [sec] = await tx.insert(sections).values({ userId, documentId, ord: s, title: TEXT[s]!.section, pageStart: TEXT[s]!.page, pageEnd: TEXT[s]!.page }).returning();
      for (const p of TEXT[s]!.paragraphs) {
        const [c] = await tx.insert(chunks).values({ userId, documentId, sectionId: sec!.id, ord: ord++, page: TEXT[s]!.page, text: p }).returning();
        chunkIds.push(c!.id);
      }
    }
    const claimId: Record<string, string> = {};
    const claimChunk = new Map<string, string>();
    for (const [i, c] of CLAIMS.entries()) {
      const [row] = await tx
        .insert(claims)
        .values({
          userId,
          documentId,
          chunkId: chunkIds[c.p]!,
          ord: i,
          kind: c.kind,
          originalText: c.text,
          quote: c.text,
          quoteVerified: true,
          verdict: "UNVERIFIABLE",
          category: "NEEDS_REVIEW",
          rationale: "Datos de demostración: no se ha realizado verificación externa.",
          verificationMethod: "demo",
          decision: "ACCEPTED_ORIGINAL",
          finalText: c.text,
          validated: true,
          validationBasis: "USER_APPROVED",
        })
        .returning();
      claimId[c.key] = row!.id;
      claimChunk.set(row!.id, chunkIds[c.p]!);
    }
    const ids = (...k: string[]) => k.map((x) => claimId[x]!);

    const mk = async (v: typeof concepts.$inferInsert, claimKeys: string[]) => {
      const [c] = await tx.insert(concepts).values(v).returning();
      await tx.insert(conceptClaims).values(ids(...claimKeys).map((id) => ({ userId, conceptId: c!.id, claimId: id })));
      return c!;
    };
    const ecc = await mk(
      {
        userId,
        documentId,
        name: "Acoplamiento excitación-contracción",
        kind: "MECHANISM",
        importance: 3,
        summary: "Secuencia que convierte el potencial de acción de la fibra muscular en la interacción actina-miosina.",
        details: {
          keyTerms: ["calcio", "troponina", "RyR1", "DHPR"],
          steps: [
            { text: "La neurona motora libera acetilcolina en la unión neuromuscular", claimIds: ids("ach") },
            { text: "La acetilcolina genera un potencial de acción en la fibra muscular", claimIds: ids("nic") },
            { text: "El potencial de acción entra por los túbulos T", claimIds: ids("tt") },
            { text: "DHPR detecta el voltaje y activa RyR1", claimIds: ids("dhpr") },
            { text: "RyR1 libera calcio del retículo sarcoplásmico", claimIds: ids("ryr") },
            { text: "El calcio se une a la troponina C y la tropomiosina expone la actina", claimIds: ids("tnc") },
            { text: "La miosina se une a la actina y produce el golpe de fuerza", claimIds: ids("cross") },
          ],
          misconceptions: ["Creer que el calcio se une a la tropomiosina", "Pensar que el ATP es necesario para que la miosina se una a la actina (lo es para separarse)"],
        },
      },
      ["ach", "nic", "tt", "dhpr", "ryr", "tnc", "cross"],
    );
    const trop = await mk(
      { userId, documentId, name: "Troponina", kind: "CONCEPT", importance: 2, summary: "La troponina C fija el calcio y, al cambiar de forma, desplaza la tropomiosina para exponer la actina.", details: { keyTerms: ["calcio", "tropomiosina"] } },
      ["tnc"],
    );
    const ryr = await mk(
      { userId, documentId, name: "Receptor de rianodina (RyR1)", kind: "STRUCTURE", importance: 2, summary: "Canal del retículo sarcoplásmico activado por DHPR que libera calcio al citosol.", details: { keyTerms: ["calcio", "DHPR"] } },
      ["dhpr", "ryr"],
    );
    const relax = await mk(
      { userId, documentId, name: "Relajación muscular", kind: "PROCESS", importance: 2, summary: "La bomba SERCA recapta calcio y la tropomiosina vuelve a cubrir la actina.", details: { keyTerms: ["SERCA", "calcio"] } },
      ["serca", "atp"],
    );
    await tx.insert(conceptRelations).values([
      { userId, documentId, fromConceptId: ryr.id, toConceptId: ecc.id, type: "PART_OF", description: "RyR1 aporta el calcio que inicia la contracción.", claimIds: ids("ryr") },
      { userId, documentId, fromConceptId: trop.id, toConceptId: ecc.id, type: "PART_OF", description: "La troponina traduce la señal de calcio en exposición de la actina.", claimIds: ids("tnc") },
      { userId, documentId, fromConceptId: relax.id, toConceptId: ecc.id, type: "CONTRASTS_WITH", description: "La relajación revierte el aumento de calcio citosólico.", claimIds: ids("serca") },
    ]);

    const open = (conceptId: string, type: "FREE_RECALL" | "EXPLAIN" | "PREDICTION" | "CASE", prompt: string, rubric: Rubric, claimKeys: string[], scenario?: string) => ({
      userId,
      documentId,
      conceptId,
      type,
      prompt,
      payload: { scenario, minWords: type === "EXPLAIN" ? 40 : undefined },
      answerKey: {},
      rubric,
      claimIds: ids(...claimKeys),
      chunkIds: [...new Set(ids(...claimKeys).map((c) => claimChunk.get(c)!))],
      generatedBy: "DEMO" as const,
    });
    const el = (id: string, description: string, keyTerms: string[], claimKeys: string[], weight = 1) => ({ id, description, keyTerms, weight, claimIds: ids(...claimKeys) });

    const acts: (typeof activities.$inferInsert)[] = [
      open(
        ecc.id,
        "EXPLAIN",
        "Explica, como si se lo enseñaras a un compañero, cómo un impulso de la neurona motora acaba produciendo la contracción del músculo esquelético.",
        {
          referenceAnswer: "La neurona motora libera acetilcolina, que genera un potencial de acción en la fibra; este entra por los túbulos T, DHPR activa RyR1, se libera calcio del retículo sarcoplásmico, el calcio se une a la troponina C, la tropomiosina deja libres los sitios de la actina y la miosina se une y produce el golpe de fuerza.",
          essentialElements: [
            el("e1", "Señal en la unión neuromuscular", ["acetilcolina"], ["ach"]),
            el("e2", "Vía de entrada del potencial de acción", ["túbulos T", "tubulos t", "túbulo"], ["tt"]),
            el("e3", "Sensor de voltaje y canal de liberación", ["DHPR", "RyR1", "rianodina", "dihidropiridina"], ["dhpr"], 2),
            el("e4", "Origen del ion desencadenante", ["retículo sarcoplásmico", "reticulo", "calcio"], ["ryr"], 2),
            el("e5", "Proteína que fija el ion", ["troponina"], ["tnc"], 2),
          ],
          relations: [el("r1", "Consecuencia sobre los sitios de la actina", ["tropomiosina", "actina"], ["tnc"], 2), el("r2", "Generación de fuerza", ["miosina", "golpe de fuerza"], ["cross"])],
          criticalErrors: [{ id: "x1", description: "Afirma que el calcio se une a la tropomiosina", tag: "calcio-se-une-a-tropomiosina" }],
          optionalElements: ["Receptores nicotínicos"],
          precision: "CONCEPTUAL",
          hints: ["Empieza por lo que ocurre en la unión neuromuscular y sigue el recorrido de la señal.", "¿Qué ion actúa de interruptor y de dónde sale?", "Recuerda la cadena túbulos T → DHPR → RyR1 → calcio → troponina."],
          explanation:
            "1) La neurona motora libera acetilcolina. 2) Se genera un potencial de acción en la fibra. 3) Entra por los túbulos T. 4) DHPR detecta el voltaje y activa RyR1. 5) RyR1 libera calcio del retículo sarcoplásmico. 6) El calcio se une a la troponina C y la tropomiosina expone la actina. 7) La miosina se une a la actina y produce el golpe de fuerza.",
        },
        ["ach", "nic", "tt", "dhpr", "ryr", "tnc", "cross"],
      ),
      open(
        ecc.id,
        "PREDICTION",
        "¿Qué ocurriría con la contracción muscular si un fármaco impidiera la liberación de calcio desde el retículo sarcoplásmico, aunque el potencial de acción llegue con normalidad? Justifica tu predicción.",
        {
          referenceAnswer: "No habría contracción: sin calcio citosólico la troponina C no lo fija, la tropomiosina sigue cubriendo los sitios de la actina y la miosina no puede unirse, aunque haya potencial de acción.",
          essentialElements: [el("e1", "Predicción sobre la contracción", ["no habría contracción", "no se contrae", "no hay contracción", "sin contracción"], ["ryr", "tnc"], 2), el("e2", "Papel de la proteína que fija el ion", ["troponina"], ["tnc"])],
          relations: [el("r1", "Estado de los sitios de unión de la actina", ["tropomiosina", "bloquea", "cubre"], ["tnc"], 2), el("r2", "Disociación entre señal eléctrica y mecánica", ["potencial de acción"], ["tt", "ryr"])],
          criticalErrors: [{ id: "x1", description: "Predice una contracción mantenida o más intensa", tag: "prediccion-contraccion-aumentada" }],
          optionalElements: [],
          precision: "CONCEPTUAL",
          hints: ["Piensa en qué paso de la cadena se interrumpe.", "¿Qué necesita la troponina para cambiar de forma?", "Si la tropomiosina no se desplaza, ¿puede la miosina unirse a la actina?"],
          explanation: "Bloquear la liberación de calcio desde el retículo sarcoplásmico impide que el calcio se una a la troponina C; la tropomiosina sigue cubriendo los sitios de la actina, la miosina no puede unirse y no hay contracción aunque el potencial de acción sea normal (desacoplamiento excitación-contracción).",
        },
        ["ryr", "tnc"],
      ),
      open(
        trop.id,
        "FREE_RECALL",
        "Sin mirar el material: ¿qué función cumple la troponina en la contracción muscular?",
        {
          referenceAnswer: "La troponina C fija el calcio y, al cambiar de forma, desplaza la tropomiosina, exponiendo los sitios de unión de la actina para la miosina.",
          essentialElements: [el("e1", "Ion que fija", ["calcio", "ca2+", "ca"], ["tnc"], 2), el("e2", "Proteína que desplaza", ["tropomiosina"], ["tnc"])],
          relations: [el("r1", "Consecuencia sobre la actina", ["actina", "sitios de unión"], ["tnc"], 2)],
          criticalErrors: [{ id: "x1", description: "Confunde troponina con tropomiosina", tag: "confunde-troponina-tropomiosina" }],
          optionalElements: ["Subunidad C"],
          precision: "CONCEPTUAL",
          hints: ["Piensa en el ion que inicia la contracción.", "La troponina está unida a otra proteína reguladora del filamento delgado.", "¿Qué consigue que la miosina pueda unirse a la actina?"],
          explanation: "La troponina C fija el calcio; ese cambio desplaza la tropomiosina y deja expuestos los sitios de unión de la actina, de modo que la miosina puede unirse.",
        },
        ["tnc"],
      ),
      open(
        relax.id,
        "CASE",
        "Aplica lo aprendido a esta situación nueva y explica qué esperarías observar y por qué.",
        {
          referenceAnswer: "La relajación se retrasaría: si SERCA no recapta el calcio, este permanece en el citosol unido a la troponina y la tropomiosina no vuelve a cubrir la actina.",
          essentialElements: [el("e1", "Efecto sobre la relajación", ["relajación", "relaja", "más lenta", "retras"], ["serca"], 2), el("e2", "Destino del calcio citosólico", ["calcio", "citosol"], ["serca"])],
          relations: [el("r1", "Estado de la tropomiosina y la actina", ["tropomiosina", "actina"], ["serca", "tnc"])],
          criticalErrors: [{ id: "x1", description: "Afirma que la contracción no puede iniciarse", tag: "serca-impide-inicio" }],
          optionalElements: [],
          precision: "CONCEPTUAL",
          hints: ["¿Qué proceso depende de la bomba mencionada?", "¿Dónde quedaría el calcio?", "Si el calcio sigue unido a la troponina, ¿qué pasa con la tropomiosina?"],
          explanation: "SERCA recapta el calcio hacia el retículo sarcoplásmico para permitir la relajación. Si funciona peor, el calcio permanece más tiempo en el citosol, la troponina sigue ocupada y la tropomiosina tarda en volver a cubrir la actina: la relajación se retrasa.",
        },
        ["serca", "tnc"],
        "Un deportista tiene una alteración que reduce la actividad de la bomba SERCA de sus fibras musculares.",
      ),
      open(
        ryr.id,
        "FREE_RECALL",
        "¿Cómo se activa el receptor de rianodina (RyR1) y qué hace cuando se abre?",
        {
          referenceAnswer: "El DHPR de los túbulos T detecta el cambio de voltaje y activa mecánicamente a RyR1, que libera calcio desde el retículo sarcoplásmico al citosol.",
          essentialElements: [el("e1", "Activador del receptor", ["DHPR", "dihidropiridina"], ["dhpr"], 2), el("e2", "Ion que libera", ["calcio", "ca2+"], ["ryr"], 2), el("e3", "Compartimento de origen", ["retículo sarcoplásmico", "reticulo"], ["ryr"])],
          relations: [el("r1", "Localización del sensor de voltaje", ["túbulos T", "tubulos t"], ["dhpr", "tt"])],
          criticalErrors: [],
          optionalElements: [],
          precision: "CONCEPTUAL",
          hints: ["Piensa en el sensor de voltaje de los túbulos T.", "¿Qué ion sale cuando se abre?", "¿Desde qué orgánulo?"],
          explanation: "El receptor de dihidropiridina (DHPR), en los túbulos T, detecta el voltaje y activa mecánicamente a RyR1; al abrirse, RyR1 libera calcio del retículo sarcoplásmico al citosol.",
        },
        ["dhpr", "ryr"],
      ),
    ];
    const order = buildProcessOrder(ecc, claimChunk);
    if (order) acts.push({ ...order, userId, documentId, generatedBy: "DEMO" });
    const src = (k: string) => ({ id: claimId[k]!, text: CLAIMS.find((c) => c.key === k)!.text, chunkId: claimChunk.get(claimId[k]!)! });
    const cloze = buildCloze(trop, [src("tnc")]);
    if (cloze) acts.push({ ...cloze, userId, documentId, generatedBy: "DEMO" });
    const rec = buildRecognition(trop, [ecc, ryr, relax], [src("tnc")]);
    if (rec) acts.push({ ...rec, userId, documentId, generatedBy: "DEMO" });
    await tx.insert(activities).values(acts);
    return { libraryId: lib!.id, documentId, activities: acts.length };
  });
}

async function main() {
  const email = process.argv[2];
  const db = getDb();
  let userId: string;
  if (email) {
    const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!u) throw new Error(`No existe ninguna cuenta con ${email}`);
    userId = u.id;
  } else {
    const demoEmail = "demo@vance.local";
    const [u] = await db.select().from(users).where(eq(users.email, demoEmail));
    if (u) userId = u.id;
    else {
      const [n] = await db.insert(users).values({ email: demoEmail, name: "Cuenta demo", passwordHash: await hashPassword("demo-vance-2026"), settings: DEFAULT_SETTINGS }).returning();
      userId = n!.id;
    }
    console.log(`Cuenta de demostración: ${demoEmail} / demo-vance-2026`);
  }
  const r = await seedDemo(userId);
  console.log(`Biblioteca demo creada (${r.activities} actividades). Documento: /app/documents/${r.documentId}`);
  await getPool().end();
}

if (process.argv[1]?.endsWith("seed-demo.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
