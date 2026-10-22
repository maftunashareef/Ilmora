/** One block of a legal document shown on the site. Generated from the owner's documents, never written by hand. */
export type LegalBlock =
  | { t: 'h1' | 'lead' | 'h2' | 'p' | 'clause' | 'li'; text: string }
  | { t: 'kv'; label: string; value: string }
