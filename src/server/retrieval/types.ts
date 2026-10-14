export interface Passage {
  documentId: string;
  documentTitle: string;
  /** Fragmento local equivalente (para enlazar y mostrar la página exacta), si se localizó. */
  chunkId: string | null;
  /** Página: solo si la conocemos con certeza (fragmento local o metadato del índice). */
  page: number | null;
  text: string;
  score: number;
  provider: "LOCAL" | "GEMINI_FILE_SEARCH";
}
