export type ApplicationPlatform =
  | 'seek'
  | 'indeed'
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'smartrecruiters'
  | 'bamboohr'
  | 'ashby'
  | 'pageup'
  | 'successfactors'
  | 'taleo'
  | 'generic';

interface PlatformRule {
  platform: ApplicationPlatform;
  hostPatterns: RegExp[];
  pathPatterns?: RegExp[];
}

const PLATFORM_RULES: PlatformRule[] = [
  {
    platform: 'seek',
    hostPatterns: [/(^|\.)seek\./]
  },
  {
    platform: 'indeed',
    hostPatterns: [/(^|\.)indeed\./]
  },
  {
    platform: 'greenhouse',
    hostPatterns: [/(^|\.)greenhouse\.io$/, /(^|\.)greenhouse\.com$/]
  },
  {
    platform: 'lever',
    hostPatterns: [/(^|\.)lever\.co$/]
  },
  {
    platform: 'workday',
    hostPatterns: [/(^|\.)myworkdayjobs\.com$/, /(^|\.)workdayjobs\.com$/]
  },
  {
    platform: 'smartrecruiters',
    hostPatterns: [/(^|\.)smartrecruiters\.com$/]
  },
  {
    platform: 'bamboohr',
    hostPatterns: [/(^|\.)bamboohr\.com$/]
  },
  {
    platform: 'ashby',
    hostPatterns: [/(^|\.)ashbyhq\.com$/]
  },
  {
    platform: 'pageup',
    hostPatterns: [/(^|\.)pageuppeople\.com$/, /(^|\.)pageup\.com$/]
  },
  {
    platform: 'successfactors',
    hostPatterns: [
      /(^|\.)successfactors\.com$/,
      /(^|\.)sapsf\./,
      /(^|\.)jobs2web\.com$/,
      /(^|\.)sap\.com$/
    ],
    pathPatterns: [/\/career/i, /\/recruiting/i, /\/sfcareer/i]
  },
  {
    platform: 'taleo',
    hostPatterns: [/(^|\.)taleo\.net$/, /(^|\.)taleo\.com$/]
  }
];

const normalizeUrl = (url?: string | null): string | null => {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
};

const matchesRule = (rule: PlatformRule, parsedUrl: URL): boolean => {
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
  const hostMatches = rule.hostPatterns.some(pattern => pattern.test(hostname));
  if (!hostMatches) {
    return false;
  }

  if (!rule.pathPatterns || rule.pathPatterns.length === 0) {
    return true;
  }

  return rule.pathPatterns.some(pattern => pattern.test(`${parsedUrl.pathname}${parsedUrl.search}`));
};

export const detectPlatform = (url?: string | null): ApplicationPlatform => {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return 'generic';
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    return PLATFORM_RULES.find(rule => matchesRule(rule, parsedUrl))?.platform || 'generic';
  } catch {
    return 'generic';
  }
};
