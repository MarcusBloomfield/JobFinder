import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { BrowserContext, chromium, Page } from 'playwright';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';

const MAX_AGENT_STEPS = Number(process.env.APPLY_AGENT_MAX_STEPS || 25);
const MAX_STEP_RECOVERY_ATTEMPTS = Number(process.env.APPLY_AGENT_MAX_STEP_RECOVERY_ATTEMPTS || 3);
const MAX_VISIBLE_TEXT_CHARS = Number(process.env.APPLY_AGENT_MAX_VISIBLE_TEXT_CHARS || 5000);
const MAX_RESUME_CHARS = Number(process.env.APPLY_AGENT_MAX_RESUME_CHARS || 8000);
const APPLY_AGENT_MODEL = process.env.APPLY_AGENT_MODEL || 'gpt-5.4';
const APPLY_AGENT_REASONING_EFFORT: 'medium' = 'medium';
const APPLY_AGENT_TIMEOUT_MS = Number(process.env.APPLY_AGENT_TIMEOUT_MS || 55000);
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const PLAYWRIGHT_PROFILE_DIR = path.resolve(__dirname, '../../.playwright/seek-profile');
const APPLICATION_RUNS_DIR = path.resolve(__dirname, '../../.playwright/application-runs');
const ARTIFACTS_BASE_URL =
  process.env.APPLICATION_ARTIFACTS_BASE_URL?.trim() ||
  `http://localhost:${process.env.PORT || 5000}/artifacts`;
const SEEK_LOGIN_URL = 'https://www.seek.com.au/login';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /\b(?:\+?\d[\d()\-\s]{7,}\d)\b/;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/gi;
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;
const FORCE_CONTINUE_REVIEW_PATTERN =
  /year|experience|prefill|framework|language|selection|cover letter|resume|question|answer|skill|stack|technology/i;
const FORCE_CONTINUE_INSTRUCTION =
  'Do not stop for routine employer questions, imperfect prefilled answers, or missing exact years. Continue by using conservative resume-grounded estimates, correcting existing selections and text, replacing weak prefilled cover-letter content, and uploading or replacing the resume if the page expects it.';
const HUMAN_TYPING_DELAY_MS = 35;
const SEQUENTIAL_TYPE_MAX_CHARS = 220;

let openaiClient: OpenAI | null = null;
let seekLoginSession: { context: BrowserContext; page: Page } | null = null;

interface CandidateProfile {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  skills: string[];
  experienceHighlights: string[];
  educationHighlights: string[];
  estimatedCareerYears?: number;
  resumeSummary: string;
}

interface PageElementSnapshot {
  id: number;
  tag: string;
  type?: string | null;
  role?: string | null;
  href?: string | null;
  text: string;
  label: string;
  name?: string | null;
  placeholder?: string | null;
  value?: string | null;
  checked?: boolean;
  required?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  invalid?: boolean;
  accept?: string | null;
  inputMode?: string | null;
  autoComplete?: string | null;
  maxLength?: number | null;
  options?: string[];
  selectedOption?: string | null;
  editable?: boolean;
  clickable?: boolean;
  selectable?: boolean;
  checkable?: boolean;
  uploadable?: boolean;
}

interface PageSnapshot {
  title: string;
  url: string;
  visibleText: string;
  validationMessages: string[];
  activeElementId?: number;
  canGoBack: boolean;
  elements: PageElementSnapshot[];
}

type BrowserActionType =
  | 'click'
  | 'double_click'
  | 'hover'
  | 'focus'
  | 'clear'
  | 'type'
  | 'select'
  | 'check'
  | 'upload_resume'
  | 'press'
  | 'scroll'
  | 'scroll_into_view'
  | 'wait'
  | 'wait_for_text'
  | 'go_back'
  | 'reload'
  | 'done'
  | 'fail';

interface AgentDecision {
  reasoning: string;
  action: BrowserActionType;
  targetId?: number;
  text?: string;
  option?: string;
  checked?: boolean;
  key?: string;
  amount?: number;
  textQuery?: string;
  finalStatus?: 'applied' | 'review_required';
  message?: string;
}

interface ExecutedAction {
  action: BrowserActionType;
  targetId?: number;
  text?: string;
  option?: string;
  checked?: boolean;
  key?: string;
  amount?: number;
  textQuery?: string;
}

interface ActionVerificationResult {
  success: boolean;
  message: string;
}

interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export interface ApplicationArtifact {
  step: number;
  label: string;
  filePath: string;
  url: string;
}

export interface JobApplicationResult {
  status: 'applied' | 'review_required' | 'failed';
  message: string;
  logs: string[];
  finalUrl: string;
  steps: number;
  artifacts: ApplicationArtifact[];
}

const getOpenAIClient = (): OpenAI => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured in server environment variables.');
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

const shouldRunHeadless = (): boolean => {
  const configured = process.env.PLAYWRIGHT_HEADLESS?.toLowerCase();

  if (configured === 'true') {
    return true;
  }

  if (configured === 'false') {
    return false;
  }

  return process.env.NODE_ENV === 'production';
};

const getSlowMo = (headless: boolean): number => {
  const configured = Number(process.env.PLAYWRIGHT_SLOWMO_MS);
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }

  return headless ? 25 : 150;
};

const getBrowserChannel = (): 'chrome' | 'msedge' | undefined => {
  const configured = process.env.PLAYWRIGHT_BROWSER_CHANNEL?.toLowerCase();

  if (configured === 'chrome' || configured === 'msedge') {
    return configured;
  }

  if (process.platform === 'win32') {
    return 'chrome';
  }

  return undefined;
};

const getUserDataDir = (): string => {
  const configured = process.env.PLAYWRIGHT_USER_DATA_DIR?.trim();
  return configured ? configured : PLAYWRIGHT_PROFILE_DIR;
};

const waitWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

const compactText = (value: string, maxLength: number): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, maxLength);

const normalizeComparable = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'application-run';

const createRunArtifactsDir = (job: Job): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(APPLICATION_RUNS_DIR, `${timestamp}-${slugify(job.company)}-${slugify(job.title)}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

const toArtifactUrl = (absolutePath: string): string => {
  const relativePath = path.relative(path.resolve(__dirname, '../../.playwright'), absolutePath);
  return `${ARTIFACTS_BASE_URL}/${relativePath.replace(/\\/g, '/')}`;
};

const estimateCareerYears = (resume: Resume): number | undefined => {
  const experienceSource =
    resume.experience && resume.experience.length > 0
      ? resume.experience.join('\n')
      : resume.content;
  const currentYear = new Date().getFullYear();
  const years = Array.from(experienceSource.matchAll(YEAR_PATTERN))
    .map(match => Number(match[0]))
    .filter(year => Number.isFinite(year) && year >= 1990 && year <= currentYear);

  if (years.length === 0) {
    return undefined;
  }

  const earliest = Math.min(...years);
  const latest = Math.max(...years);
  const cappedLatest = Math.min(latest, currentYear);
  const estimatedYears = Math.max(1, cappedLatest - earliest);

  return estimatedYears > 0 ? Math.min(estimatedYears, 40) : undefined;
};

const buildCoverLetterText = (job: Job, candidateProfile: CandidateProfile): string => {
  const topSkills = candidateProfile.skills.filter(Boolean).slice(0, 4);
  const skillsText =
    topSkills.length > 0
      ? topSkills.join(', ')
      : 'software delivery, stakeholder collaboration, and problem solving';
  const experienceText = candidateProfile.experienceHighlights
    .filter(Boolean)
    .slice(0, 2)
    .map(item => compactText(item, 160))
    .join(' ');
  const yearsText = candidateProfile.estimatedCareerYears
    ? ` with around ${candidateProfile.estimatedCareerYears} years of professional experience`
    : '';

  return compactText(
    `I am applying for the ${job.title} role at ${job.company}.${yearsText} My background includes ${skillsText}. ` +
      `${experienceText ? `Relevant experience includes ${experienceText}. ` : ''}` +
      'I would welcome the opportunity to contribute to your team and discuss how my experience aligns with the role.',
    900
  );
};

const buildCandidateSummaryText = (job: Job, candidateProfile: CandidateProfile): string => {
  const topSkills = candidateProfile.skills.filter(Boolean).slice(0, 5);
  const skillsText = topSkills.length > 0 ? topSkills.join(', ') : 'relevant technical delivery';
  const yearsText = candidateProfile.estimatedCareerYears
    ? `${candidateProfile.estimatedCareerYears}+ years of experience`
    : 'relevant professional experience';

  return compactText(
    `${yearsText} across ${skillsText}, with a background relevant to the ${job.title} role at ${job.company}.`,
    420
  );
};

const extractCandidateProfile = (resume: Resume): CandidateProfile => {
  const lines = resume.content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const firstLine = lines[0];
  const email = resume.content.match(EMAIL_PATTERN)?.[0];
  const phone = resume.content.match(PHONE_PATTERN)?.[0];
  const urls = resume.content.match(URL_PATTERN) || [];
  const fullName =
    firstLine &&
    !firstLine.includes('@') &&
    firstLine.split(/\s+/).length >= 2 &&
    firstLine.split(/\s+/).length <= 5
      ? firstLine
      : undefined;
  const nameParts = fullName?.split(/\s+/).filter(Boolean) || [];

  return {
    fullName,
    firstName: nameParts.length > 0 ? nameParts[0] : undefined,
    lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined,
    email,
    phone,
    linkedin: urls.find(url => /linkedin\.com/i.test(url)),
    github: urls.find(url => /github\.com/i.test(url)),
    website: urls.find(url => !/linkedin\.com|github\.com/i.test(url)),
    skills: (resume.skills || []).map(skill => compactText(skill, 80)).filter(Boolean).slice(0, 30),
    experienceHighlights: (resume.experience || [])
      .map(item => compactText(item, 180))
      .filter(Boolean)
      .slice(0, 20),
    educationHighlights: (resume.education || [])
      .map(item => compactText(item, 180))
      .filter(Boolean)
      .slice(0, 12),
    estimatedCareerYears: estimateCareerYears(resume),
    resumeSummary: compactText(resume.content, MAX_RESUME_CHARS)
  };
};

const resolveResumeFilePath = (resume: Resume): string => {
  if (!resume.storedFileName) {
    throw new Error('Resume file is not available for auto-apply. Upload the resume again while the backend is running.');
  }

  const safeFileName = path.basename(resume.storedFileName);
  if (safeFileName !== resume.storedFileName) {
    throw new Error('Invalid stored resume token.');
  }

  const resolved = path.resolve(UPLOADS_DIR, safeFileName);
  if (!resolved.startsWith(UPLOADS_DIR)) {
    throw new Error('Resolved resume file path is outside the uploads directory.');
  }

  if (!fs.existsSync(resolved)) {
    throw new Error('Stored resume file could not be found on the server.');
  }

  return resolved;
};

const closeSeekLoginSessionIfOpen = async (): Promise<void> => {
  if (!seekLoginSession) {
    return;
  }

  try {
    await seekLoginSession.context.close();
  } catch {
    // Ignore cleanup failures for already-closed browser windows.
  } finally {
    seekLoginSession = null;
  }
};

const launchBrowserSession = async (): Promise<BrowserSession> => {
  const headless = shouldRunHeadless();
  const slowMo = getSlowMo(headless);
  const channel = getBrowserChannel();
  const userDataDir = getUserDataDir();

  console.log(`Launching application browser in ${headless ? 'headless' : 'headed'} mode`);
  console.log(`Application browser channel: ${channel ?? 'playwright-chromium'}`);
  console.log(`Using persistent browser profile: ${userDataDir}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless,
    slowMo,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    viewport: { width: 1440, height: 960 }
  });

  let page = context.pages()[0];
  if (!page) {
    page = await context.newPage();
  }

  return { context, page };
};

const settlePage = async (page: Page): Promise<void> => {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // Network idle is best effort only.
  }

  await page.waitForTimeout(800);
};

const capturePageSnapshot = async (page: Page): Promise<PageSnapshot> => {
  const snapshot = await page.evaluate((maxVisibleTextChars: number) => {
    const clean = (value: string | null | undefined, max = 280): string =>
      (value || '').replace(/\s+/g, ' ').trim().slice(0, max);

    const isVisible = (element: HTMLElement): boolean => {
      if (element instanceof HTMLInputElement && element.type === 'file') {
        return true;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const textFrom = (element: Element | null): string => {
      if (!element) {
        return '';
      }

      return clean((element as HTMLElement).innerText || element.textContent || '');
    };

    const getLabel = (element: HTMLElement): string => {
      const explicit = clean(
        element.getAttribute('aria-label') ||
          element.getAttribute('placeholder') ||
          element.getAttribute('name')
      );
      if (explicit) {
        return explicit;
      }

      if (element.id) {
        const matchingLabel = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        const labelText = textFrom(matchingLabel);
        if (labelText) {
          return labelText;
        }
      }

      const parentLabel = element.closest('label');
      const parentLabelText = textFrom(parentLabel);
      if (parentLabelText) {
        return parentLabelText;
      }

      const previousSibling = element.previousElementSibling as HTMLElement | null;
      const previousText = textFrom(previousSibling);
      if (previousText) {
        return previousText;
      }

      return textFrom(element);
    };

    document
      .querySelectorAll('[data-llm-target-id]')
      .forEach(element => element.removeAttribute('data-llm-target-id'));

    const candidates = Array.from(
      document.querySelectorAll(
        'input, textarea, select, button, a[href], [role="button"], [role="textbox"], [contenteditable="true"]'
      )
    )
      .filter(element => element instanceof HTMLElement)
      .filter(element => {
        const typed = element as HTMLInputElement;
        if (typed.type === 'hidden') {
          return false;
        }

        if (element instanceof HTMLAnchorElement) {
          const href = element.getAttribute('href') || '';
          const text = (element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (href.startsWith('#') || text === 'skip to content') {
            return false;
          }
        }

        return isVisible(element as HTMLElement);
      })
      .slice(0, 60) as HTMLElement[];

    const elements = candidates.map((element, index) => {
      const id = index + 1;
      element.setAttribute('data-llm-target-id', String(id));

      const input = element as HTMLInputElement;
      const select = element as HTMLSelectElement;
      const options =
        element instanceof HTMLSelectElement
          ? Array.from(select.options)
              .map(option => clean(option.label || option.text || option.value, 120))
              .filter(Boolean)
              .slice(0, 20)
          : undefined;

      return {
        id,
        tag: element.tagName.toLowerCase(),
        type: 'type' in input ? input.type || null : null,
        role: element.getAttribute('role'),
        href: element instanceof HTMLAnchorElement ? element.getAttribute('href') : null,
        text: textFrom(element),
        label: getLabel(element),
        name: element.getAttribute('name'),
        placeholder: element.getAttribute('placeholder'),
        value: 'value' in input ? clean(input.value, 200) : null,
        checked: 'checked' in input ? Boolean(input.checked) : undefined,
        required: 'required' in input ? Boolean(input.required) : undefined,
        disabled: 'disabled' in input ? Boolean(input.disabled) : undefined,
        hidden: !isVisible(element),
        invalid:
          element.getAttribute('aria-invalid') === 'true' ||
          ('validity' in input && typeof input.validity?.valid === 'boolean'
            ? !input.validity.valid
            : undefined),
        accept: element instanceof HTMLInputElement ? element.accept || null : null,
        inputMode: element.getAttribute('inputmode'),
        autoComplete: element.getAttribute('autocomplete'),
        maxLength:
          'maxLength' in input && typeof input.maxLength === 'number' && input.maxLength >= 0
            ? input.maxLength
            : null,
        options,
        selectedOption:
          element instanceof HTMLSelectElement
            ? clean(
                select.selectedOptions[0]?.label ||
                  select.selectedOptions[0]?.text ||
                  select.value ||
                  null,
                120
              )
            : null,
        editable:
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element.isContentEditable,
        clickable:
          element instanceof HTMLButtonElement ||
          element instanceof HTMLAnchorElement ||
          element.getAttribute('role') === 'button',
        selectable: element instanceof HTMLSelectElement,
        checkable:
          element instanceof HTMLInputElement &&
          ['checkbox', 'radio'].includes((element.type || '').toLowerCase()),
        uploadable:
          element instanceof HTMLInputElement &&
          (element.type || '').toLowerCase() === 'file'
      };
    });

    const validationMessages = Array.from(
      document.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-errormessage], .error, .errors')
    )
      .filter(element => element instanceof HTMLElement)
      .filter(element => isVisible(element as HTMLElement))
      .map(element => textFrom(element))
      .filter(Boolean)
      .slice(0, 12);

    const activeElement = document.activeElement as HTMLElement | null;
    const activeElementId = activeElement
      ? Number(activeElement.getAttribute('data-llm-target-id') || '') || undefined
      : undefined;

    return {
      title: document.title,
      url: window.location.href,
      visibleText: clean(document.body?.innerText || '', maxVisibleTextChars),
      validationMessages,
      activeElementId,
      canGoBack: window.history.length > 1,
      elements
    };
  }, MAX_VISIBLE_TEXT_CHARS);

  return snapshot;
};

const detectCompletion = (snapshot: PageSnapshot): string | null => {
  const combined = `${snapshot.title}\n${snapshot.visibleText}`.toLowerCase();
  const successPatterns = [
    /application submitted/,
    /thank you for applying/,
    /we have received your application/,
    /your application has been submitted/,
    /application complete/
  ];

  for (const pattern of successPatterns) {
    if (pattern.test(combined)) {
      return 'Detected a submission confirmation on the page.';
    }
  }

  return null;
};

const validateDecision = (value: unknown): AgentDecision => {
  if (!value || typeof value !== 'object') {
    throw new Error('LLM returned an invalid action payload.');
  }

  const decision = value as Record<string, unknown>;
  const action = decision.action;
  const reasoning = decision.reasoning;

  const validActions: BrowserActionType[] = [
    'click',
    'double_click',
    'hover',
    'focus',
    'clear',
    'type',
    'select',
    'check',
    'upload_resume',
    'press',
    'scroll',
    'scroll_into_view',
    'wait',
    'wait_for_text',
    'go_back',
    'reload',
    'done',
    'fail'
  ];

  if (typeof action !== 'string' || !validActions.includes(action as BrowserActionType)) {
    throw new Error('LLM returned an unsupported browser action.');
  }

  if (typeof reasoning !== 'string' || !reasoning.trim()) {
    throw new Error('LLM returned an action without reasoning.');
  }

  return {
    action: action as BrowserActionType,
    reasoning: reasoning.trim(),
    targetId: typeof decision.targetId === 'number' ? decision.targetId : undefined,
    text: typeof decision.text === 'string' ? decision.text : undefined,
    option: typeof decision.option === 'string' ? decision.option : undefined,
    checked: typeof decision.checked === 'boolean' ? decision.checked : undefined,
    key: typeof decision.key === 'string' ? decision.key : undefined,
    amount: typeof decision.amount === 'number' ? decision.amount : undefined,
    textQuery: typeof decision.textQuery === 'string' ? decision.textQuery : undefined,
    finalStatus:
      decision.finalStatus === 'applied' || decision.finalStatus === 'review_required'
        ? decision.finalStatus
        : undefined,
    message: typeof decision.message === 'string' ? decision.message : undefined
  };
};

const getSnapshotElement = (
  snapshot: PageSnapshot,
  targetId: number | undefined
): PageElementSnapshot | undefined => {
  if (!targetId) {
    return undefined;
  }

  return snapshot.elements.find(element => element.id === targetId);
};

const getElementHints = (element: PageElementSnapshot | undefined): string => {
  if (!element) {
    return '';
  }

  return [
    element.label,
    element.name || '',
    element.placeholder || '',
    element.text || '',
    element.type || ''
  ]
    .join(' ')
    .toLowerCase();
};

type CandidateFieldKind =
  | 'email'
  | 'phone'
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'cover_letter'
  | 'motivation'
  | 'summary'
  | 'experience_years'
  | 'generic';

const inferFieldKind = (
  decision: AgentDecision,
  snapshot: PageSnapshot
): CandidateFieldKind => {
  const targetElement = getSnapshotElement(snapshot, decision.targetId);
  const combinedHints = [
    getElementHints(targetElement),
    decision.message || '',
    decision.reasoning || ''
  ]
    .join(' ')
    .toLowerCase();

  if (combinedHints.includes('email')) return 'email';
  if (combinedHints.includes('phone') || combinedHints.includes('mobile')) return 'phone';
  if (combinedHints.includes('first name') || combinedHints.includes('given name')) return 'first_name';
  if (combinedHints.includes('last name') || combinedHints.includes('surname') || combinedHints.includes('family name')) return 'last_name';
  if (combinedHints.includes('full name') || combinedHints.includes('your name') || combinedHints.includes('name entered')) return 'full_name';
  if (combinedHints.includes('linkedin')) return 'linkedin';
  if (combinedHints.includes('github')) return 'github';
  if (combinedHints.includes('website') || combinedHints.includes('portfolio') || combinedHints.includes('url')) return 'website';
  if (combinedHints.includes('cover letter') || combinedHints.includes('covering letter')) return 'cover_letter';
  if (
    combinedHints.includes('why are you interested') ||
    combinedHints.includes('why do you want') ||
    combinedHints.includes('motivation') ||
    combinedHints.includes('why this role')
  ) {
    return 'motivation';
  }
  if (
    combinedHints.includes('about you') ||
    combinedHints.includes('professional summary') ||
    combinedHints.includes('profile summary')
  ) {
    return 'summary';
  }
  if (
    combinedHints.includes('how many years') ||
    combinedHints.includes('years experience') ||
    combinedHints.includes('years of experience') ||
    combinedHints.includes('experience in') ||
    combinedHints.includes('experience with')
  ) {
    return 'experience_years';
  }
  if (combinedHints.includes('name')) return 'full_name';

  return 'generic';
};

const elementMatchesFieldKind = (element: PageElementSnapshot, fieldKind: CandidateFieldKind): boolean => {
  const hints = getElementHints(element);

  switch (fieldKind) {
    case 'email':
      return element.type === 'email' || hints.includes('email');
    case 'phone':
      return element.type === 'tel' || hints.includes('phone') || hints.includes('mobile');
    case 'first_name':
      return hints.includes('first name') || hints.includes('given name') || hints.includes('forename');
    case 'last_name':
      return hints.includes('last name') || hints.includes('surname') || hints.includes('family name');
    case 'full_name':
      return hints.includes('full name') || hints.includes('your name') || hints.includes('name');
    case 'linkedin':
      return hints.includes('linkedin');
    case 'github':
      return hints.includes('github');
    case 'website':
      return hints.includes('website') || hints.includes('portfolio') || hints.includes('url');
    case 'cover_letter':
      return hints.includes('cover letter') || hints.includes('covering letter');
    case 'motivation':
      return (
        hints.includes('why are you interested') ||
        hints.includes('why do you want') ||
        hints.includes('motivation') ||
        hints.includes('why this role')
      );
    case 'summary':
      return (
        hints.includes('about you') ||
        hints.includes('summary') ||
        hints.includes('profile') ||
        hints.includes('introduction')
      );
    case 'experience_years':
      return (
        hints.includes('how many years') ||
        hints.includes('years experience') ||
        hints.includes('years of experience') ||
        hints.includes('experience with') ||
        hints.includes('experience in')
      );
    case 'generic':
      return true;
  }
};

const resolveFallbackTypeTargetId = (
  decision: AgentDecision,
  snapshot: PageSnapshot
): number | undefined => {
  const fieldKind = inferFieldKind(decision, snapshot);
  const editableElements = snapshot.elements.filter(
    element => element.editable && !element.disabled && !element.hidden
  );

  const bestMatch = editableElements.find(element => elementMatchesFieldKind(element, fieldKind));
  const invalidElement = editableElements.find(element => element.invalid);
  return bestMatch?.id || invalidElement?.id || editableElements[0]?.id;
};

const getCandidateValueForFieldKind = (
  fieldKind: CandidateFieldKind,
  candidateProfile: CandidateProfile,
  job: Job
): string | undefined => {
  switch (fieldKind) {
    case 'email':
      return candidateProfile.email;
    case 'phone':
      return candidateProfile.phone;
    case 'first_name':
      return candidateProfile.firstName;
    case 'last_name':
      return candidateProfile.lastName;
    case 'full_name':
      return candidateProfile.fullName;
    case 'linkedin':
      return candidateProfile.linkedin;
    case 'github':
      return candidateProfile.github;
    case 'website':
      return candidateProfile.website || candidateProfile.linkedin || candidateProfile.github;
    case 'cover_letter':
    case 'motivation':
      return buildCoverLetterText(job, candidateProfile);
    case 'summary':
      return buildCandidateSummaryText(job, candidateProfile);
    case 'experience_years':
      return candidateProfile.estimatedCareerYears?.toString();
    case 'generic':
      return undefined;
  }
};

const resolveAutofillText = (
  decision: AgentDecision,
  snapshot: PageSnapshot,
  candidateProfile: CandidateProfile,
  job: Job
): string | undefined => {
  if (decision.action !== 'type') {
    return decision.text;
  }

  if (typeof decision.text === 'string' && decision.text.trim()) {
    return decision.text;
  }

  const fieldKind = inferFieldKind(decision, snapshot);
  const element = getSnapshotElement(snapshot, decision.targetId);
  if (!element) {
    return getCandidateValueForFieldKind(fieldKind, candidateProfile, job);
  }

  const hints = [
    element.label,
    element.name || '',
    element.placeholder || '',
    element.text || '',
    element.type || ''
  ]
    .join(' ')
    .toLowerCase();

  if (element.type === 'email' || hints.includes('email')) {
    return candidateProfile.email;
  }

  if (
    element.type === 'tel' ||
    hints.includes('phone') ||
    hints.includes('mobile') ||
    hints.includes('contact number')
  ) {
    return candidateProfile.phone;
  }

  if (hints.includes('first name') || hints.includes('given name') || hints.includes('forename')) {
    return candidateProfile.firstName;
  }

  if (hints.includes('last name') || hints.includes('surname') || hints.includes('family name')) {
    return candidateProfile.lastName;
  }

  if (hints.includes('full name') || hints.includes('your name') || hints === 'name') {
    return candidateProfile.fullName;
  }

  if (hints.includes('linkedin')) {
    return candidateProfile.linkedin;
  }

  if (hints.includes('github')) {
    return candidateProfile.github;
  }

  if (
    hints.includes('website') ||
    hints.includes('portfolio') ||
    hints.includes('personal site') ||
    hints.includes('url')
  ) {
    return candidateProfile.website || candidateProfile.linkedin || candidateProfile.github;
  }

  if (hints.includes('cover letter') || hints.includes('covering letter')) {
    return buildCoverLetterText(job, candidateProfile);
  }

  if (
    hints.includes('why are you interested') ||
    hints.includes('why do you want') ||
    hints.includes('motivation') ||
    hints.includes('why this role')
  ) {
    return buildCoverLetterText(job, candidateProfile);
  }

  if (
    hints.includes('about you') ||
    hints.includes('summary') ||
    hints.includes('profile') ||
    hints.includes('introduction')
  ) {
    return buildCandidateSummaryText(job, candidateProfile);
  }

  if (
    hints.includes('how many years') ||
    hints.includes('years experience') ||
    hints.includes('years of experience') ||
    hints.includes('experience with') ||
    hints.includes('experience in')
  ) {
    return candidateProfile.estimatedCareerYears?.toString();
  }

  if (hints.includes('name')) {
    return candidateProfile.fullName;
  }

  return getCandidateValueForFieldKind(fieldKind, candidateProfile, job);
};

const resolveSelectOption = (
  decision: AgentDecision,
  snapshot: PageSnapshot
): string | undefined => {
  if (!decision.option) {
    return undefined;
  }

  const element = getSnapshotElement(snapshot, decision.targetId);
  const options = element?.options || [];
  if (options.length === 0) {
    return decision.option;
  }

  const desired = normalizeComparable(decision.option);
  if (!desired) {
    return decision.option;
  }

  const exactMatch = options.find(option => normalizeComparable(option) === desired);
  if (exactMatch) {
    return exactMatch;
  }

  const fuzzyMatch = options.find(option => {
    const normalizedOption = normalizeComparable(option);
    return normalizedOption.includes(desired) || desired.includes(normalizedOption);
  });

  return fuzzyMatch || decision.option;
};

const shouldForceContinueAutomation = (
  decision: AgentDecision,
  snapshot: PageSnapshot
): boolean => {
  if (decision.action !== 'done' || decision.finalStatus !== 'review_required') {
    return false;
  }

  const hasActionableFormFields = snapshot.elements.some(
    element =>
      !element.disabled &&
      !element.hidden &&
      (element.editable || element.selectable || element.checkable || element.uploadable)
  );

  if (!hasActionableFormFields) {
    return false;
  }

  const combinedReason = `${decision.message || ''} ${decision.reasoning || ''}`;
  return FORCE_CONTINUE_REVIEW_PATTERN.test(combinedReason);
};

const planNextAction = async (
  job: Job,
  resume: Resume,
  candidateProfile: CandidateProfile,
  snapshot: PageSnapshot,
  logs: string[],
  extraInstruction?: string,
  attemptFeedback?: string
): Promise<AgentDecision> => {
  const openai = getOpenAIClient();

  const response = await waitWithTimeout(
    openai.chat.completions.create({
      model: APPLY_AGENT_MODEL,
      reasoning_effort: APPLY_AGENT_REASONING_EFFORT,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are controlling a browser to complete a job application using only the provided structured page snapshot. ' +
            'Respond only with JSON. Be truthful and use only candidate information present in the provided profile or resume summary. ' +
            'Do not invent qualifications, salary expectations, or sponsorship answers. ' +
            'If a required employer question asks for years of experience or skill exposure, infer a conservative estimate from the resume evidence and choose the lowest supported answer rather than stopping. ' +
            'Prefer concise professional answers. ' +
            'You have a Playwright-backed browser toolset, not raw code execution. ' +
            'Use these actions only: click, double_click, hover, focus, clear, type, select, check, upload_resume, press, scroll, scroll_into_view, wait, wait_for_text, go_back, reload, done, fail. ' +
            'Only use type on elements where editable=true, select on selectable=true, check on checkable=true, upload_resume on uploadable=true, and click/double_click/hover/focus/scroll_into_view on elements that are relevant visible targets. ' +
            'Every click, double_click, hover, focus, clear, type, select, check, upload_resume, and scroll_into_view action must include a valid numeric targetId from the current page snapshot. ' +
            'For every type action, you must include the exact literal string to enter in the "text" field. Never omit it. ' +
            'Return exactly one JSON object and nothing else. Do not include markdown, code fences, commentary, or multiple JSON objects. ' +
            'Use clear before type when a text field already contains inaccurate, generic, or irrelevant content. ' +
            'Use hover or focus when menus, tooltips, or lazy controls need activation before clicking or typing. ' +
            'Use scroll_into_view when the needed target is off-screen or blocked by sticky layout. ' +
            'Use wait_for_text when you expect visible page text, validation copy, or a new question section to appear. ' +
            'Treat recent verification logs as authoritative. If a recent log says a field now matches the entered text or selected option, do not rewrite that field again unless new validation messages or the latest snapshot show it is empty, invalid, or changed. ' +
            'If attemptFeedback is provided, correct that exact failure and choose a different valid action when repeating the same action would be ineffective. ' +
            'Use page.validationMessages, element.invalid, element.value, and element.selectedOption to correct blocked or prefilled fields before giving up. ' +
            'Treat current input values, selected options, checked states, resume uploads, and cover-letter drafts as editable drafts that must be verified and corrected when inaccurate, generic, or mismatched. ' +
            'If a resume or CV upload field is visible and the application expects one, use upload_resume to attach the current resume file. ' +
            'If a cover-letter or motivation field is visible, write a concise tailored answer grounded in the resume and job description. ' +
            'Use done only when the application is submitted or the page clearly shows a confirmation or only non-essential follow-up remains. ' +
            'Use finalStatus=review_required only for captcha, MFA, legal declarations not supported by the resume, or truly missing personal information that cannot be conservatively inferred. ' +
            'If blocked or impossible, use fail with a concise message.'
        },
        {
          role: 'user',
          content: JSON.stringify(
            {
              job: {
                title: job.title,
                company: job.company,
                description: compactText(job.description, 2500),
                url: job.url
              },
              candidateProfile,
              resumeSummary: compactText(resume.content, MAX_RESUME_CHARS),
              page: snapshot,
              recentLogs: logs.slice(-8),
              extraInstruction: extraInstruction || null,
              attemptFeedback: attemptFeedback || null,
              outputSchema: {
                reasoning: 'string',
                action:
                  'click | double_click | hover | focus | clear | type | select | check | upload_resume | press | scroll | scroll_into_view | wait | wait_for_text | go_back | reload | done | fail',
                targetId: 'number when targeting an element',
                text: 'string for type actions',
                option: 'string for select actions',
                checked: 'boolean for check actions',
                key: 'string for press actions',
                amount: 'number for scroll or wait actions',
                textQuery: 'string for wait_for_text actions',
                finalStatus: 'applied | review_required for done actions',
                message: 'short human-readable status message'
              }
            },
            null,
            2
          )
        }
      ]
    }),
    APPLY_AGENT_TIMEOUT_MS
  );

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error('LLM returned an empty action response.');
  }

  try {
    return validateDecision(JSON.parse(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parsing error';
    throw new Error(
      `LLM returned invalid JSON action output: ${message}. Response preview: "${compactText(
        String(content),
        320
      )}".`
    );
  }
};

const getTargetLocator = (page: Page, targetId: number) =>
  page.locator(`[data-llm-target-id="${targetId}"]`).first();

const prepareTargetLocator = async (page: Page, targetId: number) => {
  const locator = getTargetLocator(page, targetId);
  await locator.waitFor({ state: 'attached', timeout: 5000 });
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {
    try {
      await locator.waitFor({ state: 'visible', timeout: 2000 });
    } catch {
      throw new Error(`Target ${targetId} is no longer available on the page.`);
    }
  }
  return locator;
};

const clearEditableTarget = async (page: Page, targetId: number, snapshot: PageSnapshot): Promise<void> => {
  const element = getSnapshotElement(snapshot, targetId);
  if (!element?.editable) {
    throw new Error(`Resolved clear target ${targetId} is not editable.`);
  }

  const locator = await prepareTargetLocator(page, targetId);
  await locator.click({ timeout: 10000 });

  if (element.tag === 'textarea' || element.tag === 'input') {
    await locator.fill('', { timeout: 10000 });
    await page.waitForTimeout(150);
    return;
  }

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
};

const typeIntoTarget = async (
  page: Page,
  targetId: number,
  text: string,
  snapshot: PageSnapshot
): Promise<void> => {
  const element = getSnapshotElement(snapshot, targetId);
  if (!element?.editable) {
    throw new Error(`Resolved type target ${targetId} is not editable.`);
  }

  const locator = await prepareTargetLocator(page, targetId);
  await locator.click({ timeout: 10000 });

  if (element.tag === 'textarea' || element.tag === 'input') {
    await locator.fill('', { timeout: 10000 });
    if (text.length <= SEQUENTIAL_TYPE_MAX_CHARS) {
      await locator.pressSequentially(text, { delay: HUMAN_TYPING_DELAY_MS });
    } else {
      await locator.fill(text, { timeout: 10000 });
    }
    await page.waitForTimeout(200);
    return;
  }

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  if (text.length <= SEQUENTIAL_TYPE_MAX_CHARS) {
    await page.keyboard.insertText('');
    await locator.pressSequentially(text, { delay: HUMAN_TYPING_DELAY_MS });
  } else {
    await page.keyboard.insertText(text);
  }
  await page.waitForTimeout(200);
};

const waitForVisibleText = async (page: Page, textQuery: string, timeoutMs = 10000): Promise<void> => {
  const normalized = textQuery.trim();
  if (!normalized) {
    throw new Error('LLM wait_for_text action did not include textQuery.');
  }

  await page
    .getByText(normalized, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: Math.max(500, Math.min(20000, timeoutMs)) });
};

const captureRunScreenshot = async (
  page: Page,
  runArtifactsDir: string,
  step: number,
  label: string
): Promise<ApplicationArtifact> => {
  const fileName = `${String(step).padStart(2, '0')}-${slugify(label)}.png`;
  const filePath = path.join(runArtifactsDir, fileName);
  await page.screenshot({ path: filePath, fullPage: true });

  return {
    step,
    label,
    filePath,
    url: toArtifactUrl(filePath)
  };
};

const getElementComparableValue = (element: PageElementSnapshot | undefined): string => {
  if (!element) {
    return '';
  }

  return normalizeComparable(element.value || element.selectedOption || element.text || '');
};

const buildExpectedComparablePrefix = (value: string, maxLength = 120): string =>
  normalizeComparable(value).slice(0, maxLength);

const verifyActionOutcome = (
  executedAction: ExecutedAction,
  beforeSnapshot: PageSnapshot,
  afterSnapshot: PageSnapshot
): ActionVerificationResult => {
  const beforeElement = getSnapshotElement(beforeSnapshot, executedAction.targetId);
  const afterElement = getSnapshotElement(afterSnapshot, executedAction.targetId);

  switch (executedAction.action) {
    case 'clear': {
      const afterValue = getElementComparableValue(afterElement);
      return afterValue.length === 0
        ? { success: true, message: `Verified target ${executedAction.targetId} is now empty.` }
        : { success: false, message: `Target ${executedAction.targetId} still contains text after clear.` };
    }
    case 'type': {
      const afterValue = getElementComparableValue(afterElement);
      const expectedPrefix = buildExpectedComparablePrefix(executedAction.text || '');
      const success =
        afterValue.length > 0 &&
        expectedPrefix.length > 0 &&
        (afterValue.startsWith(expectedPrefix) || expectedPrefix.startsWith(afterValue));

      return success
        ? { success: true, message: `Verified target ${executedAction.targetId} now matches the entered text.` }
        : {
            success: false,
            message: `Target ${executedAction.targetId} does not match the entered text yet. Current value: "${compactText(afterElement?.value || afterElement?.text || '', 120)}".`
          };
    }
    case 'select': {
      const selected = normalizeComparable(afterElement?.selectedOption || afterElement?.value || '');
      const expected = normalizeComparable(executedAction.option || '');
      return selected && expected && (selected === expected || selected.includes(expected) || expected.includes(selected))
        ? { success: true, message: `Verified select target ${executedAction.targetId} is now set to "${afterElement?.selectedOption || afterElement?.value || executedAction.option}".` }
        : { success: false, message: `Select target ${executedAction.targetId} did not reach the requested option.` };
    }
    case 'check': {
      return afterElement?.checked === executedAction.checked
        ? { success: true, message: `Verified target ${executedAction.targetId} checked state is ${executedAction.checked}.` }
        : { success: false, message: `Target ${executedAction.targetId} checked state did not change as requested.` };
    }
    case 'upload_resume': {
      const beforeInvalid = Boolean(beforeElement?.invalid);
      const afterInvalid = Boolean(afterElement?.invalid);
      return !afterInvalid || (beforeInvalid && !afterInvalid)
        ? { success: true, message: `Verified the resume upload field no longer appears invalid.` }
        : { success: true, message: `Resume upload was attempted. Review the screenshot if the page still needs confirmation.` };
    }
    case 'wait_for_text': {
      const query = normalizeComparable(executedAction.textQuery || executedAction.text || '');
      const visibleText = normalizeComparable(afterSnapshot.visibleText);
      return query && visibleText.includes(query)
        ? { success: true, message: `Verified the expected text is now visible.` }
        : { success: false, message: `Expected text "${executedAction.textQuery || executedAction.text}" is not visible yet.` };
    }
    case 'click':
    case 'double_click':
    case 'press':
    case 'go_back':
    case 'reload': {
      const changed =
        beforeSnapshot.url !== afterSnapshot.url ||
        beforeSnapshot.activeElementId !== afterSnapshot.activeElementId ||
        normalizeComparable(beforeSnapshot.visibleText) !== normalizeComparable(afterSnapshot.visibleText);
      return changed
        ? { success: true, message: `Verified page state changed after ${executedAction.action}.` }
        : { success: true, message: `No major visible change detected after ${executedAction.action}, but the action completed.` };
    }
    case 'hover':
    case 'focus':
    case 'scroll':
    case 'scroll_into_view':
    case 'wait':
      return { success: true, message: `${executedAction.action} completed.` };
    case 'done':
    case 'fail':
      return { success: true, message: `${executedAction.action} requested.` };
  }
};

const executeDecision = async (
  page: Page,
  decision: AgentDecision,
  resumeFilePath: string,
  snapshot: PageSnapshot,
  candidateProfile: CandidateProfile,
  job: Job
): Promise<ExecutedAction> => {
  switch (decision.action) {
    case 'click': {
      if (!decision.targetId) {
        throw new Error('LLM click action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).click({ timeout: 10000 });
      await settlePage(page);
      return { action: 'click', targetId: decision.targetId };
    }
    case 'double_click': {
      if (!decision.targetId) {
        throw new Error('LLM double_click action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).dblclick({ timeout: 10000 });
      await settlePage(page);
      return { action: 'double_click', targetId: decision.targetId };
    }
    case 'hover': {
      if (!decision.targetId) {
        throw new Error('LLM hover action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).hover({ timeout: 10000 });
      await page.waitForTimeout(300);
      return { action: 'hover', targetId: decision.targetId };
    }
    case 'focus': {
      if (!decision.targetId) {
        throw new Error('LLM focus action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).focus({ timeout: 10000 });
      await page.waitForTimeout(200);
      return { action: 'focus', targetId: decision.targetId };
    }
    case 'clear': {
      if (!decision.targetId) {
        throw new Error('LLM clear action did not include a targetId.');
      }
      await clearEditableTarget(page, decision.targetId, snapshot);
      return { action: 'clear', targetId: decision.targetId };
    }
    case 'type': {
      const text = resolveAutofillText(decision, snapshot, candidateProfile, job);
      const resolvedTargetId = resolveFallbackTypeTargetId(decision, snapshot);
      if (!resolvedTargetId || text === undefined) {
        const element = getSnapshotElement(snapshot, resolvedTargetId || decision.targetId);
        const hint = element
          ? `target "${element.label || element.name || element.placeholder || element.text || element.tag}"`
          : 'unknown target';
        throw new Error(`LLM type action did not include text and no autofill value was available for ${hint}.`);
      }
      await typeIntoTarget(page, resolvedTargetId, text, snapshot);
      return { action: 'type', targetId: resolvedTargetId, text };
    }
    case 'select': {
      if (!decision.targetId || !decision.option) {
        throw new Error('LLM select action did not include both targetId and option.');
      }
      const locator = await prepareTargetLocator(page, decision.targetId);
      const resolvedOption = resolveSelectOption(decision, snapshot) || decision.option;
      try {
        await locator.selectOption({ label: resolvedOption }, { timeout: 10000 });
      } catch {
        try {
          await locator.selectOption({ value: resolvedOption }, { timeout: 10000 });
        } catch {
          await locator.selectOption(resolvedOption, { timeout: 10000 });
        }
      }
      await settlePage(page);
      return { action: 'select', targetId: decision.targetId, option: resolvedOption };
    }
    case 'check': {
      if (!decision.targetId || decision.checked === undefined) {
        throw new Error('LLM check action did not include both targetId and checked.');
      }
      const locator = await prepareTargetLocator(page, decision.targetId);
      if (decision.checked) {
        await locator.check({ timeout: 10000 });
      } else {
        await locator.uncheck({ timeout: 10000 });
      }
      await page.waitForTimeout(250);
      return { action: 'check', targetId: decision.targetId, checked: decision.checked };
    }
    case 'upload_resume': {
      if (!decision.targetId) {
        throw new Error('LLM upload_resume action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).setInputFiles(resumeFilePath, {
        timeout: 10000
      });
      await settlePage(page);
      return { action: 'upload_resume', targetId: decision.targetId };
    }
    case 'press': {
      if (decision.targetId) {
        await (await prepareTargetLocator(page, decision.targetId)).focus();
        await page.waitForTimeout(100);
      }
      await page.keyboard.press(decision.key || 'Tab');
      await page.waitForTimeout(250);
      return { action: 'press', targetId: decision.targetId, key: decision.key || 'Tab' };
    }
    case 'scroll': {
      await page.mouse.wheel(0, decision.amount || 750);
      await page.waitForTimeout(250);
      return { action: 'scroll', amount: decision.amount || 750 };
    }
    case 'scroll_into_view': {
      if (!decision.targetId) {
        throw new Error('LLM scroll_into_view action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).scrollIntoViewIfNeeded({
        timeout: 10000
      });
      await page.waitForTimeout(200);
      return { action: 'scroll_into_view', targetId: decision.targetId };
    }
    case 'wait': {
      const waitMs = Math.max(250, Math.min(10000, decision.amount || 1500));
      await page.waitForTimeout(waitMs);
      return { action: 'wait', amount: waitMs };
    }
    case 'wait_for_text': {
      const textQuery = decision.textQuery || decision.text || '';
      await waitForVisibleText(
        page,
        textQuery,
        decision.amount || 10000
      );
      await page.waitForTimeout(150);
      return { action: 'wait_for_text', textQuery, amount: decision.amount || 10000 };
    }
    case 'go_back': {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await settlePage(page);
      return { action: 'go_back' };
    }
    case 'reload': {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await settlePage(page);
      return { action: 'reload' };
    }
    case 'done':
    case 'fail':
      return { action: decision.action };
  }
};

export const applyToJob = async (job: Job, resume: Resume): Promise<JobApplicationResult> => {
  const candidateProfile = extractCandidateProfile(resume);
  const resumeFilePath = resolveResumeFilePath(resume);
  const runArtifactsDir = createRunArtifactsDir(job);
  await closeSeekLoginSessionIfOpen();
  const session = await launchBrowserSession();
  const logs: string[] = [];
  const artifacts: ApplicationArtifact[] = [];
  let lastSnapshot: PageSnapshot | null = null;

  try {
    const { page } = session;
    logs.push(`Opening job page: ${job.url}`);
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settlePage(page);
    artifacts.push(await captureRunScreenshot(page, runArtifactsDir, 0, 'initial-page'));

    for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
      lastSnapshot = await capturePageSnapshot(page);

      const completionMessage = detectCompletion(lastSnapshot);
      if (completionMessage) {
        logs.push(`Step ${step}: ${completionMessage}`);
        return {
          status: 'applied',
          message: completionMessage,
          logs,
          finalUrl: lastSnapshot.url,
          steps: step,
          artifacts
        };
      }

      let workingSnapshot = lastSnapshot;
      let attemptFeedback: string | undefined;
      let stepExtraInstruction: string | undefined;
      let stepCompleted = false;

      for (let attempt = 1; attempt <= MAX_STEP_RECOVERY_ATTEMPTS; attempt += 1) {
        const attemptLabel = attempt === 1 ? `Step ${step}` : `Step ${step} attempt ${attempt}`;

        try {
          let decision = await planNextAction(
            job,
            resume,
            candidateProfile,
            workingSnapshot,
            logs,
            stepExtraInstruction,
            attemptFeedback
          );

          if (shouldForceContinueAutomation(decision, workingSnapshot)) {
            logs.push(
              `${attemptLabel}: continuing instead of review - ${decision.message || decision.reasoning.slice(0, 180)}`
            );
            stepExtraInstruction = FORCE_CONTINUE_INSTRUCTION;
            decision = await planNextAction(
              job,
              resume,
              candidateProfile,
              workingSnapshot,
              logs,
              stepExtraInstruction,
              attemptFeedback
            );
          }

          logs.push(
            `${attemptLabel}: ${decision.action} - ${decision.message || decision.reasoning.slice(0, 180)}`
          );

          if (decision.action === 'done') {
            artifacts.push(
              await captureRunScreenshot(page, runArtifactsDir, step, `step-${step}-attempt-${attempt}-done`)
            );
            return {
              status: decision.finalStatus || 'review_required',
              message: decision.message || 'Application flow reached a stopping point.',
              logs,
              finalUrl: workingSnapshot.url,
              steps: step,
              artifacts
            };
          }

          if (decision.action === 'fail') {
            artifacts.push(
              await captureRunScreenshot(page, runArtifactsDir, step, `step-${step}-attempt-${attempt}-fail`)
            );
            return {
              status: 'failed',
              message: decision.message || 'Application agent could not continue.',
              logs,
              finalUrl: workingSnapshot.url,
              steps: step,
              artifacts
            };
          }

          const executedAction = await executeDecision(
            page,
            decision,
            resumeFilePath,
            workingSnapshot,
            candidateProfile,
            job
          );
          const postActionSnapshot = await capturePageSnapshot(page);
          const verification = verifyActionOutcome(executedAction, workingSnapshot, postActionSnapshot);
          logs.push(`${attemptLabel} check - ${verification.message}`);
          artifacts.push(
            await captureRunScreenshot(
              page,
              runArtifactsDir,
              step,
              `step-${step}-attempt-${attempt}-${decision.action}`
            )
          );
          workingSnapshot = postActionSnapshot;
          lastSnapshot = postActionSnapshot;

          if (verification.success) {
            stepCompleted = true;
            break;
          }

          if (attempt >= MAX_STEP_RECOVERY_ATTEMPTS) {
            throw new Error(
              `Step ${step} did not pass verification after ${MAX_STEP_RECOVERY_ATTEMPTS} attempts. ${verification.message}`
            );
          }

          attemptFeedback = compactText(
            `The previous attempt used action "${executedAction.action}" and did not succeed. ${verification.message} Do not repeat the same ineffective action unless the latest snapshot clearly shows it is necessary.`,
            500
          );
          logs.push(
            `Step ${step} retry ${attempt + 1}/${MAX_STEP_RECOVERY_ATTEMPTS} - ${verification.message}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown step error';
          try {
            artifacts.push(
              await captureRunScreenshot(
                page,
                runArtifactsDir,
                step,
                `step-${step}-attempt-${attempt}-error`
              )
            );
          } catch {
            // Ignore screenshot failures while recovering from the original step error.
          }

          logs.push(`${attemptLabel} failed - ${message}`);

          try {
            workingSnapshot = await capturePageSnapshot(page);
            lastSnapshot = workingSnapshot;
          } catch {
            // Keep the previous snapshot if the current page cannot be captured.
          }

          if (attempt >= MAX_STEP_RECOVERY_ATTEMPTS) {
            throw new Error(
              `Step ${step} failed after ${MAX_STEP_RECOVERY_ATTEMPTS} attempts. ${message}`
            );
          }

          attemptFeedback = compactText(
            `The previous attempt failed with this error: ${message} Return one corrected JSON action for the current page state, and do not repeat the same invalid response or unavailable target.`,
            500
          );
          logs.push(
            `Step ${step} retry ${attempt + 1}/${MAX_STEP_RECOVERY_ATTEMPTS} - ${message}`
          );
        }
      }

      if (!stepCompleted) {
        throw new Error(`Step ${step} could not be completed.`);
      }
    }

    return {
      status: 'review_required',
      message: `Reached the maximum of ${MAX_AGENT_STEPS} browser steps before confirming submission.`,
      logs,
      finalUrl: lastSnapshot?.url || job.url,
      steps: MAX_AGENT_STEPS,
      artifacts
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown application error';
    try {
      artifacts.push(
        await captureRunScreenshot(session.page, runArtifactsDir, logs.length + 1, 'failure-state')
      );
    } catch {
      // Ignore screenshot failures while reporting the original apply error.
    }
    logs.push(`Failed: ${message}`);
    return {
      status: 'failed',
      message,
      logs,
      finalUrl: lastSnapshot?.url || job.url,
      steps: logs.length,
      artifacts
    };
  } finally {
    await session.context.close();
  }
};

export const openSeekLoginBrowser = async (): Promise<{ message: string; profileDir: string; url: string }> => {
  if (seekLoginSession) {
    try {
      await seekLoginSession.page.goto(SEEK_LOGIN_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await seekLoginSession.page.bringToFront();
      return {
        message: 'Seek login browser is already open. Log in there once, then future auto-apply runs will reuse this profile.',
        profileDir: getUserDataDir(),
        url: seekLoginSession.page.url()
      };
    } catch {
      await closeSeekLoginSessionIfOpen();
    }
  }

  const channel = getBrowserChannel();
  const userDataDir = getUserDataDir();
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless: false,
    slowMo: Math.max(150, getSlowMo(false)),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    viewport: { width: 1440, height: 960 }
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(SEEK_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.bringToFront();

  context.on('close', () => {
    if (seekLoginSession?.context === context) {
      seekLoginSession = null;
    }
  });

  seekLoginSession = { context, page };

  return {
    message: 'Opened a Playwright-controlled Seek login window. Log in once there and later auto-apply runs will reuse the same Chrome profile.',
    profileDir: userDataDir,
    url: page.url()
  };
};
