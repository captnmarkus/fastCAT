export type LanguageEntry = {
  canonical: string;
  language: string;
  region?: string;
  displayName?: string;
  active: boolean;
  allowedAsSource: boolean;
  allowedAsTarget: boolean;
  isDefaultSource?: boolean;
  isDefaultTarget?: boolean;
};

export type LanguageDefaults = {
  defaultSource?: string;
  defaultTargets?: string[];
};

export type LanguageConfig = {
  languages: LanguageEntry[];
  defaults: LanguageDefaults;
  allowSingleLanguage?: boolean;
};
