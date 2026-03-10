export type ProjectRow = {
  id: number;
  name: string;
  description?: string | null;
  src_lang: string;
  tgt_lang: string;
  target_langs?: any;
  status: string;
  published_at?: string | null;
  init_error?: string | null;
  provisioning_started_at?: string | null;
  provisioning_updated_at?: string | null;
  provisioning_finished_at?: string | null;
  provisioning_progress?: number | null;
  provisioning_current_step?: string | null;
  created_by: string | null;
  assigned_user: string | null;
  tm_sample: string | null;
  tm_sample_tm_id: number | null;
  glossary_id: number | null;
  department_id?: number | null;
  department_name?: string | null;
  project_settings?: any;
  created_at: string;
  last_modified_at?: string | null;
  error_count?: number | null;
};

export type SegmentRow = {
  id: number;
  project_id: number;
  file_id: number;
  seg_index: number;
  src: string;
  tgt: string | null;
  src_runs?: any;
  tgt_runs?: any;
  segment_context?: any;
  origin_details?: any;
  status: string;
  version: number;
  source_type?: string | null;
  source_score?: number | null;
  source_match_id?: string | null;
};

export type SegmentSourceType = "tmx" | "nmt" | "ntm_draft" | "llm" | "manual" | "none";

export type TermbaseEntryRow = {
  id: number;
  glossary_id: number;
  concept_id: string | null;
  source_lang: string;
  target_lang: string;
  term: string;
  translation: string;
  notes: string | null;
  meta_json?: any;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export type TermbaseAudit = {
  createdAt?: string | null;
  createdBy?: string | null;
  modifiedAt?: string | null;
  modifiedBy?: string | null;
};

export type TermbaseMatchTerm = {
  termId: string;
  text: string;
  status: "preferred" | "allowed" | "forbidden";
  notes: string | null;
  partOfSpeech: string | null;
  fields?: Record<string, any> | null;
  updatedAt: string | null;
  audit?: TermbaseAudit | null;
};

export type TermbaseMatchSection = {
  language: string;
  terms: TermbaseMatchTerm[];
  fields?: Record<string, any> | null;
};

export type TermbaseMatchEntry = {
  entryId: string;
  entry: {
    fields?: Record<string, any> | null;
    audit?: TermbaseAudit | null;
  };
  source?: TermbaseMatchSection | null;
  target?: TermbaseMatchSection | null;
  illustration?: { filename: string; url: string | null } | null;
};

export type TermbaseFieldMap = Record<string, any>;
export type TermbaseLanguageFields = Record<string, TermbaseFieldMap>;
export type TermbaseTermFields = Record<string, Record<string, TermbaseFieldMap>>;
export type TermbaseTermAudit = Record<string, Record<string, TermbaseAudit>>;

export type ProjectFileListRow = {
  id: number;
  original_name: string;
  created_at: string;
  total: number | null;
  draft: number | null;
  under_review: number | null;
  reviewed: number | null;
};

export type ProjectTaskRow = {
  id: number;
  file_id: number;
  target_lang: string;
  translator_user: string;
  reviewer_user: string | null;
  status: string;
  total: number | null;
  draft: number | null;
  under_review: number | null;
  reviewed: number | null;
};
