export type InboxFilters = {
  statuses: string[];
  srcLang: string;
  tgtLang: string;
  projectId: string;
  createdStart: string;
  createdEnd: string;
  modifiedStart: string;
  modifiedEnd: string;
  types: string[];
};

export const DEFAULT_FILTERS: InboxFilters = {
  statuses: [],
  srcLang: "",
  tgtLang: "",
  projectId: "",
  createdStart: "",
  createdEnd: "",
  modifiedStart: "",
  modifiedEnd: "",
  types: []
};

