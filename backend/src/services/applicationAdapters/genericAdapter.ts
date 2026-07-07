import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { BrowserContext, chromium, Locator, Page } from 'playwright';
import { ApplicationProfile } from '../../models/ApplicationProfile';
import { Resume } from '../../models/Resume';
import {
  createHumanIntervention,
  HumanInterventionReason,
  waitForHumanInterventionResolution
} from '../humanInterventionService';
import {
  ApplicationRunUpdateInput,
  getApplicationRunById,
  markApplicationRunReadyForReview,
  markApplicationRunSkipped,
  markApplicationRunSubmitted,
  markApplicationRunWaitingForUser,
  updateApplicationRun
} from '../applicationRunTrackingService';
import {
  extractVisibleFormControls,
  ExtractedFormControl,
  FormExtractionResult,
  FORM_EXTRACTION_SERVICE_VERSION
} from '../formExtractionService';
import {
  mapExtractedFormControls,
  FormHumanReviewCategory,
  FormMappingDecision,
  FormMappingResult,
  FORM_MAPPING_SERVICE_VERSION
} from '../formMappingService';
import { ApplicationPlatform } from '../applicationPlatformService';
import {
  ApplicationAdapter,
  ApplicationAdapterArtifact,
  ApplicationContext,
  ApplicationResult
} from './types';
import { buildApplicationSnapshot } from './seekAdapter';

const MAX_AGENT_STEPS = Math.max(1, Number(process.env.APPLY_AGENT_MAX_STEPS || 25));
const HUMAN_INTERVENTION_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.APPLY_AGENT_INTERVENTION_TIMEOUT_MS || 30 * 60 * 1000)
);
const HUMAN_INTERVENTION_POLL_MS = Math.max(
  500,
  Number(process.env.APPLY_AGENT_INTERVENTION_POLL_MS || 1000)
);
const MAX_VISIBLE_TEXT_CHARS = Math.max(
  1000,
  Number(process.env.APPLY_AGENT_MAX_VISIBLE_TEXT_CHARS || 5000)
);
const ARTIFACTS_BASE_URL =
  process.env.APPLICATION_ARTIFACTS_BASE_URL?.trim() ||
  `http://localhost:${process.env.PORT || 5000}/artifacts`;
const PLAYWRIGHT_DIR = path.resolve(__dirname, '../../../.playwright');
const APPLICATION_RUNS_DIR = path.join(PLAYWRIGHT_DIR, 'application-runs');
const UPLOADS_DIR = path.resolve(__dirname, '../../../uploads');

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /\b(?:\+?\d[\d()\-\s]{7,}\d)\b/;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/gi;
const SUBMISSION_TEXT_PATTERN =
  /\b(application submitted|application received|thank you for applying|your application has been submitted)\b/i;
const CAPTCHA_PATTERN =
  /\b(captcha|recaptcha|hcaptcha|turnstile|i am human|not a robot|are you human|human verification|verify you are human|solve the puzzle|press and hold|cloudflare challenge)\b/i;
const BOT_CHECK_PATTERN =
  /\b(bot check|bot detection|anti-bot|automated traffic|unusual traffic|checking your browser|browser check|security check|security verification|access check|challenge page)\b/i;
const LOGIN_PAGE_TEXT_PATTERN =
  /\b(sign in to apply|log in to apply|login to apply|sign in or create an account|log in or create an account|create an account to continue|single sign-on|single sign on|sso|saml|oauth)\b/i;
const ACCOUNT_PAGE_TEXT_PATTERN =
  /\b(create account|create an account|create your account|new account|candidate account|account creation|set up your account|create your profile)\b/i;
const WEAK_ACCOUNT_TEXT_PATTERN =
  /\b(sign up|signup|register|registration|join now)\b/i;
const PASSWORD_TEXT_PATTERN =
  /\b(password|create password|confirm password|new password|choose a password|set password|password required)\b/i;
const ACCOUNT_SECURITY_TEXT_PATTERN =
  /\b(account security|security question|security answer|secret question|secret answer|recovery question|recovery email|mother'?s maiden name)\b/i;
const LOGIN_BUTTON_TEXT_PATTERN =
  /^(log in|login|sign in|sign-in|sign in to apply|sign up|signup|register|create account|create an account|create profile|create your profile|apply with linkedin|continue with google|continue with microsoft|continue with apple|continue with facebook|continue with linkedin|continue with sso|sign in with google|sign in with microsoft|sign in with apple|sign in with facebook|sign in with linkedin|sign in with sso|log in with google|log in with microsoft|log in with apple|log in with facebook|log in with linkedin|log in with sso|single sign-on|sso)$/i;
const VERIFICATION_TEXT_PATTERN =
  /\b(verification code|verify your email|email verification|verify email|verify your identity|identity verification|two-factor|two factor|two-step|two step|2fa|mfa|multi-factor|multifactor|otp|one-time password|one time password|authenticator|sms code|text message code|magic link|passcode)\b/i;
const AUTH_URL_PATTERN =
  /\/(login|log-in|signin|sign-in|signup|sign-up|register|registration|create-account|account\/login|oauth|sso|saml)(?:[/?#]|$)/i;
const APPLICATION_FORM_FIELD_PATTERN =
  /\b(first name|last name|full name|given name|family name|email address|phone|mobile|resume|cv|cover letter|address|city|suburb|postcode|postal code|linkedin|portfolio|work experience|education|current employer|notice period)\b/i;
const NEXT_BUTTON_PATTERN =
  /^(continue|next|save and continue|review|review application|continue application|proceed|apply now|continue to application)$/i;
const FINAL_SUBMIT_BUTTON_PATTERN =
  /^(submit|submit application|submit your application|send application|complete application|finish application|confirm application|apply)$/i;
const REVIEW_BUTTON_PATTERN = /^(review|review application|preview|preview application)$/i;
const TRUE_PATTERN = /^(true|yes|y|1|checked|check|on|agree|agreed|accept|accepted)$/i;
const FALSE_PATTERN = /^(false|no|n|0|unchecked|uncheck|off)$/i;

interface ButtonCandidate {
  text: string;
  selector: string;
  type?: string;
  disabled: boolean;
}

interface StepSnapshot {
  url: string;
  title: string;
  visibleText: string;
  controls: FormExtractionResult;
  buttons: ButtonCandidate[];
}

interface GenericBlockerSnapshot {
  url?: string;
  title?: string;
  visibleText?: string;
  controls?: Array<Partial<ExtractedFormControl>>;
  buttons?: Array<Partial<ButtonCandidate>>;
}

export type GenericApplicationStepAction =
  | 'submitted_detected'
  | 'pause_for_blocker'
  | 'pause_for_final_review'
  | 'submit_final'
  | 'navigate_next'
  | 'manual_review';

export interface GenericApplicationStepValidationResult {
  action: GenericApplicationStepAction;
  reason?: HumanInterventionReason;
  message: string;
  buttonText?: string;
}

interface InterventionOutcome {
  resolution: 'continued' | 'skipped' | 'failed' | 'pending';
  interventionId: string;
  approvedAnswers: ApprovedHumanAnswer[];
}

interface ResumeUploadPayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

interface ApprovedHumanAnswer {
  controlIndex: number;
  question: string;
  answer: string;
  controlKind?: string;
  safetyCategory?: string;
  savedFormAnswerId?: string;
}

export interface GenericFormAdapterConfig {
  id: string;
  displayName: string;
  platform: ApplicationPlatform;
  supportedPlatforms: ApplicationPlatform[];
  profileDirName: string;
  stepLimitLabel?: string;
  failureMessage?: string;
  coverLetterManualMessage?: string;
  forceFinalReview?: boolean;
}

type GenericFormAdapterRuntimeConfig = Pick<
  GenericFormAdapterConfig,
  | 'id'
  | 'displayName'
  | 'profileDirName'
  | 'stepLimitLabel'
  | 'failureMessage'
  | 'coverLetterManualMessage'
  | 'forceFinalReview'
>;

const GENERIC_FORM_ADAPTER_METADATA_KEY = 'genericFormAdapterConfig';

const DEFAULT_GENERIC_FORM_ADAPTER_CONFIG: GenericFormAdapterConfig = {
  id: 'generic',
  displayName: 'Generic application flow',
  platform: 'generic',
  supportedPlatforms: [
    'greenhouse',
    'lever',
    'workday',
    'smartrecruiters',
    'bamboohr',
    'ashby',
    'pageup',
    'successfactors',
    'taleo',
    'generic'
  ],
  profileDirName: 'generic-profile',
  stepLimitLabel: 'generic adapter',
  failureMessage: 'Generic adapter failed.',
  coverLetterManualMessage:
    'Cover-letter upload was detected and requires manual handling in generic adapter V1.',
  forceFinalReview: false
};

const isRuntimeConfigRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readRuntimeText = (
  runtimeConfig: Record<string, unknown> | undefined,
  key: keyof GenericFormAdapterRuntimeConfig,
  fallback: string
): string => {
  const value = runtimeConfig?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

const readRuntimeBoolean = (
  runtimeConfig: Record<string, unknown> | undefined,
  key: keyof GenericFormAdapterRuntimeConfig,
  fallback: boolean
): boolean => {
  const value = runtimeConfig?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

const getRuntimeConfig = (context: ApplicationContext): Required<GenericFormAdapterRuntimeConfig> => {
  const runtimeConfig = context.metadata?.[GENERIC_FORM_ADAPTER_METADATA_KEY];
  const record = isRuntimeConfigRecord(runtimeConfig) ? runtimeConfig : undefined;

  return {
    id: readRuntimeText(record, 'id', DEFAULT_GENERIC_FORM_ADAPTER_CONFIG.id),
    displayName: readRuntimeText(
      record,
      'displayName',
      DEFAULT_GENERIC_FORM_ADAPTER_CONFIG.displayName
    ),
    profileDirName: readRuntimeText(
      record,
      'profileDirName',
      DEFAULT_GENERIC_FORM_ADAPTER_CONFIG.profileDirName
    ),
    stepLimitLabel: readRuntimeText(
      record,
      'stepLimitLabel',
      DEFAULT_GENERIC_FORM_ADAPTER_CONFIG.stepLimitLabel || 'generic adapter'
    ),
    failureMessage: readRuntimeText(
      record,
      'failureMessage',
      DEFAULT_GENERIC_FORM_ADAPTER_CONFIG.failureMessage || 'Generic adapter failed.'
    ),
    coverLetterManualMessage: readRuntimeText(
      record,
      'coverLetterManualMessage',
      DEFAULT_GENERIC_FORM_ADAPTER_CONFIG.coverLetterManualMessage ||
        'Cover-letter upload was detected and requires manual handling in generic adapter V1.'
    ),
    forceFinalReview: readRuntimeBoolean(
      record,
      'forceFinalReview',
      Boolean(DEFAULT_GENERIC_FORM_ADAPTER_CONFIG.forceFinalReview)
    )
  };
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'application-run';

const compactText = (value: string | undefined, maxLength = 280): string =>
  (value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const normalizeForCompare = (value: string | undefined): string =>
  compactText(value, 2000).toLowerCase();

const createRunArtifactsDir = (jobUrl: string, applicationRunId?: string): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = slugify(jobUrl);
  const directory = applicationRunId
    ? path.join(APPLICATION_RUNS_DIR, applicationRunId)
    : path.join(APPLICATION_RUNS_DIR, `${timestamp}-${slug}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

const toArtifactUrl = (absolutePath: string): string => {
  const relativePath = path.relative(PLAYWRIGHT_DIR, absolutePath);
  return `${ARTIFACTS_BASE_URL}/${relativePath.replace(/\\/g, '/')}`;
};

const writeArtifact = (
  runArtifactsDir: string,
  step: number,
  label: string,
  extension: string,
  content: string
): { filePath: string; url: string } => {
  const fileName = `${String(step).padStart(2, '0')}-${slugify(label)}.${extension.replace(/^\./, '')}`;
  const filePath = path.join(runArtifactsDir, fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  return {
    filePath,
    url: toArtifactUrl(filePath)
  };
};

const captureScreenshot = async (
  page: Page,
  runArtifactsDir: string,
  step: number,
  label: string
): Promise<ApplicationAdapterArtifact> => {
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

const mergeRunMetadata = (
  applicationRunId: string | undefined,
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!metadata) {
    return undefined;
  }

  if (!applicationRunId) {
    return metadata;
  }

  const existing = getApplicationRunById(applicationRunId)?.metadata || {};
  const existingArtifacts = Array.isArray(existing.artifactUrls) ? existing.artifactUrls : [];
  const nextArtifacts = Array.isArray(metadata.artifactUrls) ? metadata.artifactUrls : [];

  return {
    ...existing,
    ...metadata,
    artifactUrls: [...existingArtifacts, ...nextArtifacts]
  };
};

const updateRunProgress = (
  applicationRunId: string | undefined,
  updates: ApplicationRunUpdateInput
): void => {
  if (!applicationRunId) {
    return;
  }

  try {
    updateApplicationRun(applicationRunId, {
      ...updates,
      metadata: mergeRunMetadata(applicationRunId, updates.metadata)
    });
  } catch (error) {
    console.warn(
      'Failed to update generic application run:',
      error instanceof Error ? error.message : error
    );
  }
};

const shouldRunHeadless = (): boolean => {
  const configured = process.env.PLAYWRIGHT_HEADLESS?.toLowerCase();
  if (configured === 'true') {
    return true;
  }
  if (configured === 'false') {
    return false;
  }
  return false;
};

const getSlowMo = (headless: boolean): number => {
  const configured = Number(process.env.PLAYWRIGHT_SLOWMO_MS);
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return headless ? 25 : 120;
};

const getBrowserChannel = (): 'chrome' | 'msedge' | undefined => {
  const configured = process.env.PLAYWRIGHT_BROWSER_CHANNEL?.toLowerCase();
  if (configured === 'chrome' || configured === 'msedge') {
    return configured;
  }
  return process.platform === 'win32' ? 'chrome' : undefined;
};

const settlePage = async (page: Page): Promise<void> => {
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
};

const openGenericBrowser = async (
  jobUrl: string,
  profileDirName: string
): Promise<BrowserContext> => {
  const profileDir = path.join(PLAYWRIGHT_DIR, profileDirName);
  fs.mkdirSync(profileDir, { recursive: true });
  const headless = shouldRunHeadless();
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: getBrowserChannel(),
    headless,
    slowMo: getSlowMo(headless),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    viewport: { width: 1440, height: 960 }
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await settlePage(page);
  return context;
};

const resolveResumeFilePath = (resume: Resume): string => {
  if (!resume.storedFileName) {
    throw new Error('Resume file is not available for generic auto-apply.');
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

const getResumeUploadPayload = (resume: Resume): ResumeUploadPayload => ({
  name: path.basename(resume.fileName || '').trim() || `resume.${resume.fileType}`,
  mimeType:
    resume.fileType === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: fs.readFileSync(resolveResumeFilePath(resume))
});

const inferFullNameFromResume = (resume: Resume): string => {
  const lines = resume.content
    .split(/\r?\n/)
    .map(line => compactText(line, 120))
    .filter(Boolean);
  return (
    lines.find(line => /^[A-Za-z][A-Za-z\s.'-]{2,}$/.test(line) && !EMAIL_PATTERN.test(line)) || ''
  );
};

const inferUrl = (resume: Resume, matcher: RegExp): string => {
  const urls = resume.content.match(URL_PATTERN) || [];
  return urls.find(url => matcher.test(url)) || '';
};

const buildEffectiveProfile = (
  resume: Resume,
  profile?: ApplicationProfile
): ApplicationProfile => ({
  fullName: profile?.fullName || inferFullNameFromResume(resume),
  email: profile?.email || resume.content.match(EMAIL_PATTERN)?.[0] || '',
  phone: profile?.phone || resume.content.match(PHONE_PATTERN)?.[0] || '',
  currentLocation: profile?.currentLocation || '',
  homeAddress: profile?.homeAddress || '',
  maxAutoApplyDistanceKm: profile?.maxAutoApplyDistanceKm || '',
  linkedinUrl: profile?.linkedinUrl || inferUrl(resume, /linkedin\.com/i),
  portfolioUrl: profile?.portfolioUrl || '',
  githubUrl: profile?.githubUrl || inferUrl(resume, /github\.com/i),
  noticePeriod: profile?.noticePeriod || '',
  availability: profile?.availability || '',
  professionalSummary: profile?.professionalSummary || compactText(resume.content, 600),
  skillsDetails: profile?.skillsDetails || resume.skills?.filter(Boolean).slice(0, 16).join(', ') || '',
  previousJobsDetails:
    profile?.previousJobsDetails || resume.experience?.filter(Boolean).slice(0, 5).join(' ') || '',
  educationDetails:
    profile?.educationDetails || resume.education?.filter(Boolean).slice(0, 4).join(' ') || '',
  workRightsStatus: profile?.workRightsStatus || '',
  workRightsDetails: profile?.workRightsDetails || '',
  driversLicenceStatus: profile?.driversLicenceStatus || '',
  carAccessStatus: profile?.carAccessStatus || '',
  salaryExpectationAnnual: profile?.salaryExpectationAnnual || '',
  employerQuestionNotes: profile?.employerQuestionNotes || '',
  coverLetterExamples: profile?.coverLetterExamples || []
});

const summarizeHumanDecisions = (decisions: FormMappingDecision[]): string =>
  decisions
    .slice(0, 6)
    .map(decision => {
      const category = decision.humanReviewCategory
        ? decision.humanReviewCategory.replace(/_/g, ' ')
        : 'manual review';
      return `${category}: ${compactText(decision.reason, 140)}`;
    })
    .join(' | ');

const getControlQuestion = (control: ExtractedFormControl | undefined): string => {
  if (!control) {
    return 'Unknown application question';
  }

  return compactText(
    control.labelText ||
      control.ariaLabel ||
      control.placeholder ||
      control.parentText ||
      control.nearbyText ||
      control.name ||
      control.id ||
      'Unknown application question',
    500
  );
};

const getSavedAnswerControlKind = (control: ExtractedFormControl | undefined): string => {
  if (!control) {
    return 'unknown';
  }

  if (control.tag === 'textarea') {
    return 'textarea';
  }

  if (control.tag === 'select') {
    return 'select';
  }

  if (control.type === 'checkbox') {
    return 'checkbox';
  }

  if (control.type === 'radio') {
    return 'radio';
  }

  if (control.type === 'file') {
    return 'file';
  }

  return 'text';
};

const buildHumanReviewFields = (
  decisions: FormMappingDecision[],
  controls: ExtractedFormControl[]
) =>
  decisions.slice(0, 10).map(decision => {
    const control = controls.find(item => item.index === decision.controlIndex);
    return {
      controlIndex: decision.controlIndex,
      question: getControlQuestion(control),
      controlKind: getSavedAnswerControlKind(control),
      safetyCategory: decision.humanReviewCategory || 'uncertain',
      reason: compactText(decision.reason, 500),
      source: decision.source,
      savedFormAnswerId: decision.savedFormAnswerId
    };
  });

const buildSavedAnswerSuggestions = (
  decisions: FormMappingDecision[],
  controls: ExtractedFormControl[]
) =>
  decisions
    .filter(decision => decision.source === 'saved_answer')
    .slice(0, 10)
    .map(decision => {
      const control = controls.find(item => item.index === decision.controlIndex);
      return {
        controlIndex: decision.controlIndex,
        question: getControlQuestion(control),
        controlKind: getSavedAnswerControlKind(control),
        answer: decision.value || '',
        safetyCategory: 'safe',
        savedFormAnswerId: decision.savedFormAnswerId,
        reason: compactText(decision.reason, 500)
      };
    });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readApprovedHumanAnswers = (
  resolutionMessage: string | undefined
): ApprovedHumanAnswer[] => {
  if (!resolutionMessage) {
    return [];
  }

  try {
    const parsed = JSON.parse(resolutionMessage);
    if (!isRecord(parsed) || !Array.isArray(parsed.approvedAnswers)) {
      return [];
    }

    return parsed.approvedAnswers.filter(isRecord).flatMap(answer => {
      const controlIndex = answer.controlIndex;
      const value = answer.answer;
      if (typeof controlIndex !== 'number' || typeof value !== 'string' || !value.trim()) {
        return [];
      }

      return [
        {
          controlIndex,
          question: typeof answer.question === 'string' ? answer.question : '',
          answer: value.trim(),
          controlKind: typeof answer.controlKind === 'string' ? answer.controlKind : undefined,
          safetyCategory:
            typeof answer.safetyCategory === 'string' ? answer.safetyCategory : undefined,
          savedFormAnswerId:
            typeof answer.savedFormAnswerId === 'string' ? answer.savedFormAnswerId : undefined
        }
      ];
    });
  } catch {
    return [];
  }
};

const mapHumanCategoryToReason = (
  category: FormHumanReviewCategory | undefined
): HumanInterventionReason => {
  switch (category) {
    case 'legal':
      return 'unsupported_declaration';
    case 'availability':
    case 'reference':
    case 'unsupported':
      return 'missing_information';
    default:
      return 'manual_review';
  }
};

const extractVisibleText = async (page: Page): Promise<string> =>
  page.evaluate(maxChars => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, maxChars);
  }, MAX_VISIBLE_TEXT_CHARS);

const extractButtons = async (page: Page): Promise<ButtonCandidate[]> =>
  page.evaluate(() => {
    const clean = (value?: string | null): string =>
      (value || '').replace(/\s+/g, ' ').trim().slice(0, 200);

    const cssEscape = (value: string): string => {
      const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
      if (css?.escape) {
        return css.escape(value);
      }
      return value.replace(/["\\#.:,[\]= >+~*|^$()]/g, '\\$&');
    };

    const selectorCount = (selector: string): number => {
      try {
        return document.querySelectorAll(selector).length;
      } catch {
        return 0;
      }
    };

    const isVisible = (element: Element): boolean => {
      const style = window.getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      ) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    };

    const buildPath = (element: Element): string => {
      const tag = element.tagName.toLowerCase();
      const id = element.getAttribute('id');
      if (id && selectorCount(`#${cssEscape(id)}`) === 1) {
        return `#${cssEscape(id)}`;
      }

      const dataAttributes = ['data-testid', 'data-test', 'data-qa', 'data-cy'];
      for (const attribute of dataAttributes) {
        const value = element.getAttribute(attribute);
        if (value) {
          const selector = `${tag}[${attribute}="${value.replace(/"/g, '\\"')}"]`;
          if (selectorCount(selector) === 1) {
            return selector;
          }
        }
      }

      const name = element.getAttribute('name');
      if (name) {
        const selector = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
        if (selectorCount(selector) === 1) {
          return selector;
        }
      }

      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && current !== document.documentElement) {
        const currentTag = current.tagName.toLowerCase();
        let nth = 1;
        let previous = current.previousElementSibling;
        while (previous) {
          if (previous.tagName === current.tagName) {
            nth += 1;
          }
          previous = previous.previousElementSibling;
        }
        parts.unshift(`${currentTag}:nth-of-type(${nth})`);
        current = current.parentElement;
      }

      return parts.join(' > ');
    };

    const candidates = Array.from(
      document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]')
    ) as HTMLElement[];

    return candidates
      .filter(element => isVisible(element))
      .map(element => ({
        text: clean(
          element.innerText ||
            element.getAttribute('value') ||
            element.getAttribute('aria-label') ||
            element.textContent
        ),
        selector: buildPath(element),
        type: clean(element.getAttribute('type') || undefined) || undefined,
        disabled:
          element.getAttribute('aria-disabled') === 'true' ||
          ('disabled' in element ? Boolean((element as HTMLButtonElement).disabled) : false)
      }))
      .filter(candidate => candidate.selector && candidate.text);
  });

const captureStepSnapshot = async (page: Page): Promise<StepSnapshot> => {
  const [visibleText, controls, buttons] = await Promise.all([
    extractVisibleText(page),
    extractVisibleFormControls(page),
    extractButtons(page)
  ]);

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    visibleText,
    controls,
    buttons
  };
};

const saveStepDiagnostics = async (options: {
  page: Page;
  runArtifactsDir: string;
  step: number;
  label: string;
  snapshot: StepSnapshot;
  mapping?: FormMappingResult;
}): Promise<{
  screenshot: ApplicationAdapterArtifact;
  snapshotArtifact: { filePath: string; url: string };
  htmlArtifact: { filePath: string; url: string };
  textArtifact: { filePath: string; url: string };
}> => {
  const screenshot = await captureScreenshot(options.page, options.runArtifactsDir, options.step, options.label);
  const snapshotArtifact = writeArtifact(
    options.runArtifactsDir,
    options.step,
    `${options.label}-snapshot`,
    'json',
    JSON.stringify(
      {
        url: options.snapshot.url,
        title: options.snapshot.title,
        visibleText: options.snapshot.visibleText,
        buttons: options.snapshot.buttons,
        controls: options.snapshot.controls.controls,
        mapping: options.mapping
      },
      null,
      2
    )
  );
  const htmlArtifact = writeArtifact(
    options.runArtifactsDir,
    options.step,
    `${options.label}-html`,
    'html',
    await options.page.content().catch(() => '<!-- html unavailable -->')
  );
  const textArtifact = writeArtifact(
    options.runArtifactsDir,
    options.step,
    `${options.label}-visible-text`,
    'txt',
    options.snapshot.visibleText
  );

  return {
    screenshot,
    snapshotArtifact,
    htmlArtifact,
    textArtifact
  };
};

const findSubmissionSignal = (snapshot: StepSnapshot): boolean => {
  if (SUBMISSION_TEXT_PATTERN.test(snapshot.visibleText)) {
    return true;
  }

  return snapshot.buttons.some(button =>
    /view application|application complete|done/i.test(button.text)
  );
};

const getBlockingControlText = (control: Partial<ExtractedFormControl>): string =>
  [
    control.type,
    control.name,
    control.id,
    control.placeholder,
    control.ariaLabel,
    control.labelText,
    control.parentText,
    control.nearbyText,
    control.options?.map(option => `${option.label} ${option.value}`).join(' ')
  ]
    .filter(Boolean)
    .join(' ');

const hasApplicationFormSignal = (
  controls: Array<Partial<ExtractedFormControl>>,
  buttons: Array<Partial<ButtonCandidate>>
): boolean => {
  const hasApplicationField = controls.some(control => {
    if (control.type === 'password') {
      return false;
    }
    return APPLICATION_FORM_FIELD_PATTERN.test(getBlockingControlText(control));
  });

  if (hasApplicationField) {
    return true;
  }

  const hasFillableControl = controls.some(control => {
    const type = (control.type || '').toLowerCase();
    return type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'password';
  });
  const hasProgressButton = buttons.some(button =>
    NEXT_BUTTON_PATTERN.test(button.text || '') || REVIEW_BUTTON_PATTERN.test(button.text || '')
  );

  return hasFillableControl && hasProgressButton;
};

export const classifyGenericApplicationBlocker = (
  snapshot: GenericBlockerSnapshot
): { reason: HumanInterventionReason; message: string } | null => {
  const pageText = `${snapshot.title || ''} ${snapshot.visibleText || ''}`;
  const url = snapshot.url || '';
  const controls = snapshot.controls || [];
  const buttons = snapshot.buttons || [];
  const controlText = controls.map(getBlockingControlText).join(' ');
  const buttonText = buttons.map(button => button.text || '').join(' ');
  const combinedText = `${pageText} ${controlText} ${buttonText}`;
  const nonButtonText = `${pageText} ${controlText}`;
  const hasApplicationForm = hasApplicationFormSignal(controls, buttons);
  const hasAuthButton = buttons.some(button => LOGIN_BUTTON_TEXT_PATTERN.test(button.text || ''));
  const hasWeakAccountText = WEAK_ACCOUNT_TEXT_PATTERN.test(combinedText);

  if (CAPTCHA_PATTERN.test(combinedText) || BOT_CHECK_PATTERN.test(combinedText)) {
    return {
      reason: 'captcha',
      message: 'CAPTCHA or bot check detected. Complete it manually, then continue the run.'
    };
  }

  if (VERIFICATION_TEXT_PATTERN.test(combinedText)) {
    return {
      reason: 'mfa',
      message: 'Verification or MFA step detected. Complete it manually, then continue the run.'
    };
  }

  const hasPasswordField = controls.some(control => control.type === 'password');
  if (
    hasPasswordField ||
    PASSWORD_TEXT_PATTERN.test(combinedText) ||
    ACCOUNT_SECURITY_TEXT_PATTERN.test(combinedText) ||
    LOGIN_PAGE_TEXT_PATTERN.test(nonButtonText) ||
    ACCOUNT_PAGE_TEXT_PATTERN.test(nonButtonText) ||
    AUTH_URL_PATTERN.test(url.toLowerCase()) ||
    (hasAuthButton && !hasApplicationForm) ||
    (hasWeakAccountText && !hasApplicationForm)
  ) {
    return {
      reason: 'manual_review',
      message:
        'Login, account, password, SSO, or account-security step detected. Complete it manually, then continue the run.'
    };
  }

  return null;
};

const findBlockingReason = (
  snapshot: StepSnapshot
): { reason: HumanInterventionReason; message: string } | null =>
  classifyGenericApplicationBlocker({
    url: snapshot.url,
    title: snapshot.title,
    visibleText: snapshot.visibleText,
    controls: snapshot.controls.controls,
    buttons: snapshot.buttons
  });

const getFinalButton = (buttons: ButtonCandidate[]): ButtonCandidate | undefined =>
  buttons.find(button => !button.disabled && FINAL_SUBMIT_BUTTON_PATTERN.test(button.text));

const getNextButton = (buttons: ButtonCandidate[]): ButtonCandidate | undefined =>
  buttons.find(
    button =>
      !button.disabled &&
      !FINAL_SUBMIT_BUTTON_PATTERN.test(button.text) &&
      (NEXT_BUTTON_PATTERN.test(button.text) || REVIEW_BUTTON_PATTERN.test(button.text))
  );

const normalizeButtonCandidates = (
  buttons: Array<Partial<ButtonCandidate>> | undefined
): ButtonCandidate[] =>
  (buttons || []).map((button, index) => ({
    text: compactText(button.text, 120),
    selector: button.selector || `validation-button-${index}`,
    type: button.type,
    disabled: Boolean(button.disabled)
  }));

export const classifyGenericApplicationStepForValidation = (
  snapshot: GenericBlockerSnapshot & { requireFinalReview?: boolean }
): GenericApplicationStepValidationResult => {
  const buttons = normalizeButtonCandidates(snapshot.buttons);
  const validationSnapshot: StepSnapshot = {
    url: snapshot.url || '',
    title: snapshot.title || '',
    visibleText: snapshot.visibleText || '',
    buttons,
    controls: {
      url: snapshot.url || '',
      title: snapshot.title || '',
      extractedAt: new Date(0).toISOString(),
      controls: []
    }
  };

  if (findSubmissionSignal(validationSnapshot)) {
    return {
      action: 'submitted_detected',
      message: 'Application submission success signal detected.'
    };
  }

  const blocker = classifyGenericApplicationBlocker({
    url: snapshot.url,
    title: snapshot.title,
    visibleText: snapshot.visibleText,
    controls: snapshot.controls,
    buttons
  });
  if (blocker) {
    return {
      action: 'pause_for_blocker',
      reason: blocker.reason,
      message: blocker.message
    };
  }

  const finalButton = getFinalButton(buttons);
  if (finalButton) {
    if (snapshot.requireFinalReview !== false) {
      return {
        action: 'pause_for_final_review',
        reason: 'final_submission_approval',
        message: `Final submission is ready. Review the page, then continue to let the bot click "${finalButton.text}".`,
        buttonText: finalButton.text
      };
    }

    return {
      action: 'submit_final',
      message: `Final submit button "${finalButton.text}" can be clicked automatically.`,
      buttonText: finalButton.text
    };
  }

  const nextButton = getNextButton(buttons);
  if (nextButton) {
    return {
      action: 'navigate_next',
      message: `Navigation button "${nextButton.text}" can be clicked automatically.`,
      buttonText: nextButton.text
    };
  }

  return {
    action: 'manual_review',
    reason: 'manual_review',
    message: 'No safe form action or navigation button was available. Manual review required.'
  };
};

const resolveLocator = async (
  page: Page,
  control: ExtractedFormControl,
  selectorHint: FormMappingDecision['selectorHint']
): Promise<Locator> => {
  const candidates: Locator[] = [];

  if (selectorHint?.selector) {
    candidates.push(page.locator(selectorHint.selector).first());
  }
  if (selectorHint?.kind === 'label' && selectorHint.value) {
    candidates.push(page.getByLabel(selectorHint.value, { exact: false }).first());
  }
  if (control.id) {
    candidates.push(
      page.locator(`${control.tag}[id="${control.id.replace(/"/g, '\\"')}"]`).first()
    );
  }
  if (control.name) {
    candidates.push(page.locator(`${control.tag}[name="${control.name.replace(/"/g, '\\"')}"]`).first());
  }
  if (control.placeholder) {
    candidates.push(page.getByPlaceholder(control.placeholder, { exact: false }).first());
  }

  for (const locator of candidates) {
    if ((await locator.count()) > 0) {
      return locator;
    }
  }

  throw new Error(`Unable to resolve a locator for control ${control.index}.`);
};

const isDecisionAlreadySatisfied = (
  control: ExtractedFormControl,
  decision: FormMappingDecision,
  resumeFileName: string
): boolean => {
  if (decision.action === 'upload_resume') {
    return normalizeForCompare(control.currentValue).includes(normalizeForCompare(resumeFileName));
  }

  if (!decision.value) {
    return false;
  }

  if (decision.action === 'select') {
    const currentValue = normalizeForCompare(control.currentValue);
    if (currentValue === normalizeForCompare(decision.value)) {
      return true;
    }
    return control.options.some(
      option =>
        option.selected &&
        (normalizeForCompare(option.label) === normalizeForCompare(decision.value) ||
          normalizeForCompare(option.value) === normalizeForCompare(decision.value))
    );
  }

  if (decision.action === 'fill') {
    return normalizeForCompare(control.currentValue) === normalizeForCompare(decision.value);
  }

  if (decision.action === 'check') {
    return Boolean(control.checked);
  }

  if (decision.action === 'uncheck') {
    return control.checked === false;
  }

  return false;
};

const applyMappedDecision = async (
  page: Page,
  control: ExtractedFormControl,
  decision: FormMappingDecision,
  resumeUploadPayload: ResumeUploadPayload
): Promise<string> => {
  const locator = await resolveLocator(page, control, decision.selectorHint);
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);

  switch (decision.action) {
    case 'fill':
      await locator.fill(decision.value || '');
      return decision.source === 'saved_answer'
        ? `Filled ${decision.fieldKey || 'field'} with an approved answer.`
        : `Filled ${decision.fieldKey || 'field'} with safe profile data.`;
    case 'select':
      try {
        await locator.selectOption({ label: decision.value || '' });
      } catch {
        await locator.selectOption(decision.value || '');
      }
      return `Selected ${decision.value || 'option'} for ${decision.fieldKey || 'field'}.`;
    case 'check':
      await locator.check();
      return `Checked ${decision.fieldKey || 'field'} using a saved answer.`;
    case 'uncheck':
      await locator.uncheck();
      return `Unchecked ${decision.fieldKey || 'field'} using a saved answer.`;
    case 'upload_resume':
      await locator.setInputFiles(resumeUploadPayload);
      return `Uploaded resume "${resumeUploadPayload.name}".`;
    default:
      throw new Error(`Unsupported generic adapter action: ${decision.action}`);
  }
};

const actionForApprovedAnswer = (
  control: ExtractedFormControl,
  answer: string
): FormMappingDecision['action'] | undefined => {
  if (control.type === 'password') {
    return undefined;
  }

  if (control.tag === 'select') {
    return 'select';
  }

  if (control.type === 'checkbox') {
    if (TRUE_PATTERN.test(answer.trim())) {
      return 'check';
    }
    if (FALSE_PATTERN.test(answer.trim())) {
      return 'uncheck';
    }
    return undefined;
  }

  if (control.type === 'radio') {
    return 'check';
  }

  if (control.type === 'file') {
    return undefined;
  }

  return 'fill';
};

const applyApprovedHumanAnswers = async (
  page: Page,
  controls: ExtractedFormControl[],
  approvedAnswers: ApprovedHumanAnswer[],
  resumeUploadPayload: ResumeUploadPayload
): Promise<string[]> => {
  const appliedMessages: string[] = [];

  for (const approvedAnswer of approvedAnswers) {
    const control = controls.find(item => item.index === approvedAnswer.controlIndex);
    if (!control) {
      continue;
    }

    const action = actionForApprovedAnswer(control, approvedAnswer.answer);
    if (!action) {
      continue;
    }

    const decision: FormMappingDecision = {
      controlIndex: control.index,
      status: 'MAP',
      action,
      source: 'saved_answer',
      confidence: 'high',
      fieldKey: 'savedAnswer',
      value: approvedAnswer.answer,
      selectorHint: control.selectorHints[0],
      reason: `Used answer approved during human intervention for "${compactText(
        approvedAnswer.question || getControlQuestion(control),
        120
      )}".`,
      humanReviewCategory: 'uncertain',
      savedFormAnswerId: approvedAnswer.savedFormAnswerId
    };

    const message = await applyMappedDecision(page, control, decision, resumeUploadPayload);
    appliedMessages.push(message);
  }

  return appliedMessages;
};

const clickButton = async (page: Page, button: ButtonCandidate): Promise<void> => {
  const locator = page.locator(button.selector).first();
  if ((await locator.count()) === 0) {
    throw new Error(`Could not find button "${button.text}" for selector ${button.selector}.`);
  }
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await locator.click({ timeout: 15_000 });
};

const waitForIntervention = async (options: {
  context: ApplicationContext;
  step: number;
  pageUrl: string;
  message: string;
  reason: HumanInterventionReason;
  screenshot?: ApplicationAdapterArtifact;
  snapshotArtifact?: { filePath: string; url: string };
  artifactUrls?: Array<{ filePath: string; url: string }>;
  visibleText?: string;
  metadata?: Record<string, unknown>;
  logs: string[];
  readyForReviewOnTimeout?: boolean;
}): Promise<InterventionOutcome> => {
  if (options.context.applicationRunId) {
    try {
      markApplicationRunWaitingForUser(options.context.applicationRunId, {
        currentStep: options.step,
        currentUrl: options.pageUrl,
        screenshotFilePath: options.screenshot?.filePath,
        screenshotUrl: options.screenshot?.url,
        snapshotFilePath: options.snapshotArtifact?.filePath,
        snapshotUrl: options.snapshotArtifact?.url,
        errorMessage: options.message
      });
    } catch (error) {
      console.warn(
        `Failed to mark ${getRuntimeConfig(options.context).displayName} run waiting for user:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  const adapterConfig = getRuntimeConfig(options.context);
  const diagnosticArtifacts = (options.artifactUrls || []).map(artifact => ({
    filePath: artifact.filePath,
    url: artifact.url,
    kind: artifact.filePath.endsWith('.html')
      ? 'html'
      : artifact.filePath.endsWith('.txt')
        ? 'visible_text'
        : artifact.filePath.endsWith('.json')
          ? 'snapshot'
          : artifact.filePath.endsWith('.png')
            ? 'screenshot'
            : 'artifact'
  }));

  const intervention = createHumanIntervention({
    applicationId: options.context.applicationId,
    applicationRunId: options.context.applicationRunId,
    reason: options.reason,
    title: `${options.context.job.company} - ${options.context.job.title}`,
    message: options.message,
    pageUrl: options.pageUrl,
    screenshotFilePath: options.screenshot?.filePath,
    screenshotUrl: options.screenshot?.url,
    metadata: {
      jobId: options.context.job.id,
      jobUrl: options.context.job.url,
      company: options.context.job.company,
      title: options.context.job.title,
      applicationRunId: options.context.applicationRunId,
      currentUrl: options.pageUrl,
      step: options.step,
      adapterId: adapterConfig.id,
      adapterName: adapterConfig.displayName,
      diagnosticArtifacts,
      diagnostics: {
        currentUrl: options.pageUrl,
        screenshotUrl: options.screenshot?.url,
        screenshotFilePath: options.screenshot?.filePath,
        snapshotUrl: options.snapshotArtifact?.url,
        snapshotFilePath: options.snapshotArtifact?.filePath,
        htmlUrls: diagnosticArtifacts
          .filter(artifact => artifact.kind === 'html')
          .map(artifact => artifact.url),
        visibleTextUrls: diagnosticArtifacts
          .filter(artifact => artifact.kind === 'visible_text')
          .map(artifact => artifact.url),
        visibleTextExcerpt: compactText(options.visibleText, 2000)
      },
      artifactUrls: options.artifactUrls || [],
      ...(options.metadata || {})
    }
  });

  options.logs.push(`Human intervention requested: ${intervention.id}`);

  try {
    const resolution = await waitForHumanInterventionResolution(
      intervention.id,
      HUMAN_INTERVENTION_TIMEOUT_MS,
      HUMAN_INTERVENTION_POLL_MS
    );

    options.logs.push(`Human intervention resolved: ${resolution.status}`);

    if (options.context.applicationRunId && resolution.status === 'continued') {
      updateRunProgress(options.context.applicationRunId, {
        status: 'running',
        currentStep: options.step,
        currentUrl: options.pageUrl
      });
    }

    if (
      resolution.status === 'continued' ||
      resolution.status === 'skipped' ||
      resolution.status === 'failed'
    ) {
      return {
        resolution: resolution.status,
        interventionId: intervention.id,
        approvedAnswers: readApprovedHumanAnswers(resolution.resolutionMessage)
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Human intervention wait failed.';
    options.logs.push(`Human intervention unresolved: ${message}`);
    if (options.context.applicationRunId && options.readyForReviewOnTimeout) {
      markApplicationRunReadyForReview(options.context.applicationRunId, {
        currentStep: options.step,
        currentUrl: options.pageUrl,
        screenshotFilePath: options.screenshot?.filePath,
        screenshotUrl: options.screenshot?.url,
        snapshotFilePath: options.snapshotArtifact?.filePath,
        snapshotUrl: options.snapshotArtifact?.url,
        errorMessage: options.message
      });
    }
  }

  return {
    resolution: 'pending',
    interventionId: intervention.id,
    approvedAnswers: []
  };
};

const buildResult = (
  context: ApplicationContext,
  resume: Resume,
  status: ApplicationResult['status'],
  message: string,
  logs: string[],
  finalUrl: string,
  steps: number,
  artifacts: ApplicationAdapterArtifact[],
  metadata?: Record<string, unknown>
): ApplicationResult => {
  const adapterConfig = getRuntimeConfig(context);

  return {
    status,
    message,
    logs,
    finalUrl,
    steps,
    artifacts,
    applicationSnapshot: buildApplicationSnapshot(context.job, resume),
    metadata: {
      adapterId: adapterConfig.id,
      adapterName: adapterConfig.displayName,
      platform: context.platform,
      formExtraction: {
        service: 'formExtractionService',
        version: FORM_EXTRACTION_SERVICE_VERSION,
        ready: true
      },
      formMapping: {
        service: 'formMappingService',
        version: FORM_MAPPING_SERVICE_VERSION,
        ready: true
      },
      ...metadata
    }
  };
};

const finishSkipOrFail = (
  context: ApplicationContext,
  resume: Resume,
  resolution: 'skipped' | 'failed',
  message: string,
  logs: string[],
  finalUrl: string,
  steps: number,
  artifacts: ApplicationAdapterArtifact[]
): ApplicationResult =>
  buildResult(
    context,
    resume,
    resolution === 'skipped' ? 'skipped' : 'failed',
    message,
    logs,
    finalUrl,
    steps,
    artifacts
  );

const applyGeneric = async (context: ApplicationContext): Promise<ApplicationResult> => {
  const adapterConfig = getRuntimeConfig(context);
  const logs: string[] = [
    `${adapterConfig.displayName} adapter started for platform "${context.platform}".`,
    `Target URL: ${context.job.url}`
  ];
  const artifacts: ApplicationAdapterArtifact[] = [];
  const runArtifactsDir = createRunArtifactsDir(context.job.url, context.applicationRunId);
  const effectiveProfile = buildEffectiveProfile(context.resume, context.applicationProfile);
  const resumeUploadPayload = getResumeUploadPayload(context.resume);
  const requireFinalReview = adapterConfig.forceFinalReview || context.requireFinalReview !== false;
  let contextBrowser: BrowserContext | undefined;
  let currentPage: Page | undefined;
  let lastUrl = context.job.url;

  try {
    context.cancellation?.throwIfCancellationRequested();
    contextBrowser = await openGenericBrowser(context.job.url, adapterConfig.profileDirName);
    context.cancellation?.registerBrowserContext(contextBrowser);
    context.cancellation?.throwIfCancellationRequested();
    currentPage = contextBrowser.pages()[0] || (await contextBrowser.newPage());
    lastUrl = currentPage.url();

    for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
      context.cancellation?.throwIfCancellationRequested();
      await settlePage(currentPage);
      context.cancellation?.throwIfCancellationRequested();
      const snapshot = await captureStepSnapshot(currentPage);
      lastUrl = snapshot.url;
      const blockingReason = findBlockingReason(snapshot);
      const mapping = blockingReason
        ? undefined
        : await mapExtractedFormControls(snapshot.controls, effectiveProfile, {
            allowOpenAI: true
          });

      const diagnostics = await saveStepDiagnostics({
        page: currentPage,
        runArtifactsDir,
        step,
        label: `step-${step}`,
        snapshot,
        mapping
      });
      artifacts.push(diagnostics.screenshot);

      updateRunProgress(context.applicationRunId, {
        status: 'running',
        currentStep: step,
        currentUrl: snapshot.url,
        screenshotFilePath: diagnostics.screenshot.filePath,
        screenshotUrl: diagnostics.screenshot.url,
        snapshotFilePath: diagnostics.snapshotArtifact.filePath,
        snapshotUrl: diagnostics.snapshotArtifact.url,
        metadata: {
          artifactUrls: [
            diagnostics.screenshot,
            diagnostics.snapshotArtifact,
            diagnostics.htmlArtifact,
            diagnostics.textArtifact
          ]
        }
      });
      context.cancellation?.throwIfCancellationRequested();

      if (findSubmissionSignal(snapshot)) {
        if (context.applicationRunId) {
          markApplicationRunSubmitted(context.applicationRunId, {
            currentStep: step,
            currentUrl: snapshot.url,
            screenshotFilePath: diagnostics.screenshot.filePath,
            screenshotUrl: diagnostics.screenshot.url,
            snapshotFilePath: diagnostics.snapshotArtifact.filePath,
            snapshotUrl: diagnostics.snapshotArtifact.url
          });
        }

        return buildResult(
          context,
          context.resume,
          'submitted',
          'Application appears to have been submitted successfully.',
          logs,
          snapshot.url,
          step,
          artifacts
        );
      }

      if (blockingReason) {
        const intervention = await waitForIntervention({
          context,
          step,
          pageUrl: snapshot.url,
          message: blockingReason.message,
          reason: blockingReason.reason,
          screenshot: diagnostics.screenshot,
          snapshotArtifact: diagnostics.snapshotArtifact,
          artifactUrls: [
            diagnostics.screenshot,
            diagnostics.snapshotArtifact,
            diagnostics.htmlArtifact,
            diagnostics.textArtifact
          ],
          visibleText: snapshot.visibleText,
          logs
        });

        if (intervention.resolution === 'continued') {
          logs.push('Continuing after human login/verification step.');
          continue;
        }
        if (intervention.resolution === 'skipped' || intervention.resolution === 'failed') {
          return finishSkipOrFail(
            context,
            context.resume,
            intervention.resolution,
            blockingReason.message,
            logs,
            snapshot.url,
            step,
            artifacts
          );
        }

        return buildResult(
          context,
          context.resume,
          'waiting_for_user',
          blockingReason.message,
          logs,
          snapshot.url,
          step,
          artifacts
        );
      }

      if (!mapping) {
        throw new Error('Generic form mapping was not available after blocker checks.');
      }

      const actionableDecisions = mapping.mapped.filter(
        decision => decision.action !== 'upload_cover_letter'
      );
      const coverLetterUploadDecisions = mapping.mapped.filter(
        decision => decision.action === 'upload_cover_letter'
      );
      const appliedActions: string[] = [];

      for (const decision of actionableDecisions) {
        const control = snapshot.controls.controls.find(item => item.index === decision.controlIndex);
        if (!control || isDecisionAlreadySatisfied(control, decision, resumeUploadPayload.name)) {
          continue;
        }

        const message = await applyMappedDecision(currentPage, control, decision, resumeUploadPayload);
        appliedActions.push(message);
      }

      if (appliedActions.length > 0) {
        logs.push(...appliedActions.map(message => `Step ${step}: ${message}`));
        await settlePage(currentPage);
        context.cancellation?.throwIfCancellationRequested();
        continue;
      }

      const unresolvedHumanDecisions = [
        ...mapping.needsHuman,
        ...coverLetterUploadDecisions.map(decision => ({
          ...decision,
          status: 'NEEDS_HUMAN' as const,
          reason: decision.reason || adapterConfig.coverLetterManualMessage,
          humanReviewCategory: decision.humanReviewCategory || 'unsupported'
        }))
      ];

      if (unresolvedHumanDecisions.length > 0) {
        const humanReason = mapHumanCategoryToReason(
          unresolvedHumanDecisions[0].humanReviewCategory
        );
        const message =
          `Manual review required for sensitive or unknown fields. ${summarizeHumanDecisions(
            unresolvedHumanDecisions
          )}`;
        const intervention = await waitForIntervention({
          context,
          step,
          pageUrl: snapshot.url,
          message,
          reason: humanReason,
          screenshot: diagnostics.screenshot,
          snapshotArtifact: diagnostics.snapshotArtifact,
          artifactUrls: [
            diagnostics.screenshot,
            diagnostics.snapshotArtifact,
            diagnostics.htmlArtifact,
            diagnostics.textArtifact
          ],
          visibleText: snapshot.visibleText,
          metadata: {
            humanReviewFields: buildHumanReviewFields(
              unresolvedHumanDecisions,
              snapshot.controls.controls
            ),
            savedAnswerSuggestions: buildSavedAnswerSuggestions(
              mapping.mapped,
              snapshot.controls.controls
            )
          },
          logs
        });

        if (intervention.resolution === 'continued') {
          const appliedHumanAnswers = await applyApprovedHumanAnswers(
            currentPage,
            snapshot.controls.controls,
            intervention.approvedAnswers,
            resumeUploadPayload
          );
          if (appliedHumanAnswers.length > 0) {
            logs.push(...appliedHumanAnswers.map(text => `Step ${step}: ${text}`));
            await settlePage(currentPage);
          }
          logs.push('Continuing after manual field review.');
          continue;
        }
        if (intervention.resolution === 'skipped' || intervention.resolution === 'failed') {
          return finishSkipOrFail(
            context,
            context.resume,
            intervention.resolution,
            message,
            logs,
            snapshot.url,
            step,
            artifacts
          );
        }

        return buildResult(
          context,
          context.resume,
          'waiting_for_user',
          message,
          logs,
          snapshot.url,
          step,
          artifacts
        );
      }

      const finalButton = getFinalButton(snapshot.buttons);
      if (finalButton) {
        if (requireFinalReview) {
          const message = `Final submission is ready. Review the page, then continue to let the bot click "${finalButton.text}".`;
          const intervention = await waitForIntervention({
            context,
            step,
            pageUrl: snapshot.url,
            message,
            reason: 'final_submission_approval',
            screenshot: diagnostics.screenshot,
            snapshotArtifact: diagnostics.snapshotArtifact,
            artifactUrls: [
              diagnostics.screenshot,
              diagnostics.snapshotArtifact,
              diagnostics.htmlArtifact,
              diagnostics.textArtifact
            ],
            visibleText: snapshot.visibleText,
            metadata: {
              savedAnswerSuggestions: buildSavedAnswerSuggestions(
                mapping.mapped,
                snapshot.controls.controls
              )
            },
            logs,
            readyForReviewOnTimeout: true
          });

          if (intervention.resolution === 'continued') {
            await clickButton(currentPage, finalButton);
            logs.push(`Step ${step}: clicked final submit button "${finalButton.text}".`);
            await settlePage(currentPage);
            continue;
          }
          if (intervention.resolution === 'skipped' || intervention.resolution === 'failed') {
            return finishSkipOrFail(
              context,
              context.resume,
              intervention.resolution,
              message,
              logs,
              snapshot.url,
              step,
              artifacts
            );
          }

          return buildResult(
            context,
            context.resume,
            'ready_for_review',
            message,
            logs,
            snapshot.url,
            step,
            artifacts
          );
        }

        await clickButton(currentPage, finalButton);
        logs.push(`Step ${step}: clicked final submit button "${finalButton.text}".`);
        await settlePage(currentPage);
        context.cancellation?.throwIfCancellationRequested();
        continue;
      }

      const nextButton = getNextButton(snapshot.buttons);
      if (nextButton) {
        await clickButton(currentPage, nextButton);
        logs.push(`Step ${step}: clicked navigation button "${nextButton.text}".`);
        await settlePage(currentPage);
        context.cancellation?.throwIfCancellationRequested();
        continue;
      }

      const message = 'No safe form action or navigation button was available. Manual review required.';
      const intervention = await waitForIntervention({
        context,
        step,
        pageUrl: snapshot.url,
        message,
        reason: 'manual_review',
        screenshot: diagnostics.screenshot,
        snapshotArtifact: diagnostics.snapshotArtifact,
        artifactUrls: [
          diagnostics.screenshot,
          diagnostics.snapshotArtifact,
          diagnostics.htmlArtifact,
          diagnostics.textArtifact
        ],
        visibleText: snapshot.visibleText,
        logs
      });

      if (intervention.resolution === 'continued') {
        logs.push('Continuing after manual navigation review.');
        continue;
      }
      if (intervention.resolution === 'skipped' || intervention.resolution === 'failed') {
        return finishSkipOrFail(
          context,
          context.resume,
          intervention.resolution,
          message,
          logs,
          snapshot.url,
          step,
          artifacts
        );
      }

      return buildResult(
        context,
        context.resume,
        'waiting_for_user',
        message,
        logs,
        snapshot.url,
        step,
        artifacts
      );
    }

    const message = `Reached the maximum of ${MAX_AGENT_STEPS} ${adapterConfig.stepLimitLabel} steps before submission.`;
    if (context.applicationRunId) {
      markApplicationRunReadyForReview(context.applicationRunId, {
        currentStep: MAX_AGENT_STEPS,
        currentUrl: lastUrl,
        errorMessage: message
      });
    }

    return buildResult(
      context,
      context.resume,
      'ready_for_review',
      message,
      logs,
      lastUrl,
      MAX_AGENT_STEPS,
      artifacts
    );
  } catch (error) {
    if (context.cancellation?.isCancellationRequested()) {
      logs.push('Cancelled by user.');
      return buildResult(
        context,
        context.resume,
        'skipped',
        'Cancelled by user.',
        logs,
        lastUrl,
        artifacts.length,
        artifacts
      );
    }

    const message = error instanceof Error ? error.message : adapterConfig.failureMessage;
    logs.push(`Failed: ${message}`);

    if (context.applicationRunId) {
      markApplicationRunReadyForReview(context.applicationRunId, {
        currentStep: artifacts.length,
        currentUrl: lastUrl,
        errorMessage: message,
        errorStack: error instanceof Error ? error.stack : undefined
      });
    }

    return buildResult(
      context,
      context.resume,
      'failed',
      message,
      logs,
      lastUrl,
      artifacts.length,
      artifacts
    );
  } finally {
    await contextBrowser?.close().catch(() => undefined);
  }
};

export const createGenericFormAdapter = (
  config: GenericFormAdapterConfig
): ApplicationAdapter => ({
  id: config.id,
  displayName: config.displayName,
  platform: config.platform,
  supportedPlatforms: config.supportedPlatforms,
  canAutoSubmit: !config.forceFinalReview,
  apply: (context: ApplicationContext): Promise<ApplicationResult> =>
    applyGeneric({
      ...context,
      metadata: {
        ...(context.metadata || {}),
        [GENERIC_FORM_ADAPTER_METADATA_KEY]: {
          id: config.id,
          displayName: config.displayName,
          profileDirName: config.profileDirName,
          stepLimitLabel: config.stepLimitLabel,
          failureMessage: config.failureMessage,
          coverLetterManualMessage: config.coverLetterManualMessage,
          forceFinalReview: Boolean(config.forceFinalReview)
        }
      }
    })
});

export const genericAdapter: ApplicationAdapter = createGenericFormAdapter(
  DEFAULT_GENERIC_FORM_ADAPTER_CONFIG
);
