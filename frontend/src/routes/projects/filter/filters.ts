export type ProjectFilters = {
  srcLang: string;
  targetLangs: string[];
  statuses: string[];
  createdStart: string;
  createdEnd: string;
  dueStart: string;
  dueEnd: string;
  modifiedStart: string;
  modifiedEnd: string;
  overdueOnly: boolean;
  errorsOnly: boolean;
};

export const DEFAULT_FILTERS: ProjectFilters = {
  srcLang: "",
  targetLangs: [],
  statuses: [],
  createdStart: "",
  createdEnd: "",
  dueStart: "",
  dueEnd: "",
  modifiedStart: "",
  modifiedEnd: "",
  overdueOnly: false,
  errorsOnly: false
};

