export type TermbaseMeta = {
  id: number;
  name: string;
  languages: string[];
  defaultSourceLang?: string | null;
  defaultTargetLang?: string | null;
  structure?: TermbaseStructure;
  entryCount: number;
  updatedAt: string | null;
};

export type TermbaseField = {
  name: string;
  type: "text" | "textarea" | "picklist";
  values?: string[];
  multiline?: boolean;
};

export type TermbaseStructure = {
  template?: string | null;
  entry: TermbaseField[];
  language: TermbaseField[];
  term: TermbaseField[];
};

export type TermbaseCustomFields = Record<string, any>;

export type TermbaseAudit = {
  createdAt?: string | null;
  createdBy?: string | null;
  modifiedAt?: string | null;
  modifiedBy?: string | null;
};

export type TermbaseEntryListItem = {
  entryId: string;
  displayTerm: string;
  displayLang: string | null;
  updatedAt: string | null;
};

export type TermbaseEntryListResponse = {
  entries: TermbaseEntryListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type TermbaseTerm = {
  termId: string;
  text: string;
  status: "preferred" | "forbidden" | "allowed";
  notes: string | null;
  partOfSpeech: string | null;
  customFields?: TermbaseCustomFields | null;
  updatedAt: string | null;
  audit?: TermbaseAudit | null;
};

export type TermbaseLanguageSection = {
  language: string;
  terms: TermbaseTerm[];
  customFields?: TermbaseCustomFields | null;
};

export type TermbaseEntryDetail = {
  entryId: string;
  updatedAt: string | null;
  customFields?: TermbaseCustomFields | null;
  audit?: TermbaseAudit | null;
  languages: TermbaseLanguageSection[];
  illustration?: {
    filename: string;
    url: string | null;
  } | null;
};

export type TermbaseMatchTerm = {
  termId: string;
  text: string;
  status: "preferred" | "forbidden" | "allowed";
  notes: string | null;
  partOfSpeech: string | null;
  fields?: TermbaseCustomFields | null;
  updatedAt: string | null;
  audit?: TermbaseAudit | null;
};

export type TermbaseMatchSection = {
  language: string;
  terms: TermbaseMatchTerm[];
  fields?: TermbaseCustomFields | null;
};

export type TermbaseMatchEntry = {
  entryId: string;
  entry: {
    fields?: TermbaseCustomFields | null;
    audit?: TermbaseAudit | null;
  };
  source?: TermbaseMatchSection | null;
  target?: TermbaseMatchSection | null;
  illustration?: {
    filename: string;
    url: string | null;
  } | null;
};

export type TermbaseConcordanceMatchType = "exact" | "boundary" | "prefix" | "overlap" | "fuzzy";

export type TermbaseConcordanceTerm = {
  text: string;
  status: "preferred" | "allowed" | "forbidden";
  updatedAt: string | null;
};

export type TermbaseConcordanceMatch = {
  term: string;
  lang: "source" | "target";
  type: TermbaseConcordanceMatchType;
  ratio?: number;
  score: number;
  status: TermbaseConcordanceTerm["status"];
};

export type TermbaseConcordanceEntry = {
  entryId: string;
  score: number;
  matchType: TermbaseConcordanceMatchType;
  matchRatio?: number;
  matchTerm?: string | null;
  matchLang?: "source" | "target" | null;
  entryFields?: TermbaseCustomFields | null;
  updatedAt: string | null;
  sourceTerms: TermbaseConcordanceTerm[];
  targetTerms: TermbaseConcordanceTerm[];
  matches?: TermbaseConcordanceMatch[];
  illustration?: {
    filename: string;
    url: string | null;
  } | null;
};
