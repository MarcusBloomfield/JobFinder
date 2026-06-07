import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { BrowserContext, chromium, Page } from 'playwright';
import { ApplicationProfile } from '../models/ApplicationProfile';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';
import { listStoredResumes } from './resumeParserService';

const MAX_AGENT_STEPS = Number(process.env.APPLY_AGENT_MAX_STEPS || 25);
const MAX_STEP_RECOVERY_ATTEMPTS = Number(process.env.APPLY_AGENT_MAX_STEP_RECOVERY_ATTEMPTS || 3);
const MAX_VISIBLE_TEXT_CHARS = Number(process.env.APPLY_AGENT_MAX_VISIBLE_TEXT_CHARS || 5000);
const MAX_RESUME_CHARS = Number(process.env.APPLY_AGENT_MAX_RESUME_CHARS || 8000);
const APPLY_AGENT_MODEL = process.env.APPLY_AGENT_MODEL || 'gpt-5.4-mini';
const APPLY_AGENT_REASONING_EFFORT: 'medium' = 'medium';
const APPLY_AGENT_TIMEOUT_MS = Number(process.env.APPLY_AGENT_TIMEOUT_MS || 55000);
const ALLOW_EXTERNAL_WEBSITE_AUTOMATION =
  process.env.APPLY_AGENT_ALLOW_EXTERNAL_WEBSITES?.trim().toLowerCase() === 'true';
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const PLAYWRIGHT_PROFILE_DIR = path.resolve(__dirname, '../../.playwright/seek-profile');
const APPLICATION_RUNS_DIR = path.resolve(__dirname, '../../.playwright/application-runs');
const ARTIFACTS_BASE_URL =
  process.env.APPLICATION_ARTIFACTS_BASE_URL?.trim() ||
  `http://localhost:${process.env.PORT || 5000}/artifacts`;
const SEEK_LOGIN_URL = 'https://www.seek.com.au/login';
const ALLOWED_AUTO_APPLY_DOMAIN_FAMILIES = ['seek.com', 'seek.com.au'];

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /\b(?:\+?\d[\d()\-\s]{7,}\d)\b/;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/gi;
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;
const RESUME_SCORING_STOP_WORDS = new Set([
  'about',
  'above',
  'across',
  'after',
  'again',
  'also',
  'and',
  'any',
  'are',
  'around',
  'based',
  'because',
  'been',
  'being',
  'benefits',
  'between',
  'both',
  'can',
  'candidate',
  'company',
  'day',
  'days',
  'description',
  'detail',
  'duties',
  'each',
  'employee',
  'employer',
  'from',
  'full',
  'have',
  'hours',
  'into',
  'job',
  'key',
  'looking',
  'make',
  'need',
  'new',
  'our',
  'part',
  'people',
  'position',
  'required',
  'requirements',
  'responsibilities',
  'role',
  'team',
  'that',
  'the',
  'their',
  'this',
  'time',
  'was',
  'will',
  'with',
  'work',
  'working',
  'you',
  'your'
]);
const FORCE_CONTINUE_REVIEW_PATTERN =
  /year|experience|prefill|framework|language|selection|cover letter|resume|question|answer|skill|stack|technology/i;
const COMMON_APPLICATION_PROFILE_REVIEW_PATTERN =
  /work rights|working rights|right to work|authori[sz]ation|sponsorship|driver|licen[cs]e|salary|base salary|compensation|remuneration|notice|availability|transport|vehicle|car access|email|phone|mobile|name|linkedin|github|website|portfolio|location|address|suburb|postcode|about you|summary|profile|skill|technology|tool|employment|work history|previous job|education|qualification|degree|certificate/i;
const FORCE_CONTINUE_INSTRUCTION =
  'Do not stop for routine employer questions, imperfect prefilled answers, missing exact years, or common screening questions when the applicationProfile provides an explicit answer. Continue by using conservative resume-grounded estimates, applicationProfile answers for contact details, location, links, availability, notice period, profile summary, manual skills, previous jobs, education, work rights, licence, car access, salary, and recurring screening questions, correcting existing selections and text, replacing weak prefilled cover-letter content, and uploading or replacing the resume if the page expects it.';
const HUMAN_TYPING_DELAY_MS = 35;
const SEQUENTIAL_TYPE_MAX_CHARS = 220;
const REDACTED_PASSWORD_VALUE = '__redacted_password_present__';

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

interface ResumeLibraryEntry {
  resumeRef: string;
  fileName: string;
  fileType: Resume['fileType'];
  uploadedAt?: string;
  skills: string[];
  experienceHighlights: string[];
  educationHighlights: string[];
  estimatedCareerYears?: number;
  resumeSummary: string;
}

interface ResumeOption {
  resumeRef: string;
  resume: Resume;
  candidateProfile: CandidateProfile;
  filePath: string;
  promptEntry: ResumeLibraryEntry;
}

interface ResumeOptionBuildOptions {
  filePath?: string;
}

interface AvailableResumeOptionsResult {
  options: ResumeOption[];
  selectionLogs: string[];
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
  focused?: boolean;
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
  activeElementSummary?: string;
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
  resumeRef?: string;
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
  resumeRef?: string;
  resumeFileName?: string;
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

interface DecisionExecutionResult {
  executedAction: ExecutedAction;
  page: Page;
  pageChangeMessage?: string;
  nextActiveResume?: ResumeOption;
  capturedCoverLetterText?: string;
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

export interface TailoredResumeSnapshot {
  id: string;
  fileName: string;
  fileType: 'docx';
  content: string;
  filePath: string;
  url: string;
  sourceResumeId: string;
  sourceResumeFileName: string;
  matchKeywords: string[];
  tailoringNotes: string[];
  createdAt: string;
}

export interface ApplicationSnapshot {
  resumeId: string;
  resumeFileName: string;
  resumeContent: string;
  resumeIsTailored: boolean;
  resumeSourceFileName?: string;
  tailoredResume?: TailoredResumeSnapshot;
  coverLetterText?: string;
  coverLetterUsed: boolean;
}

export interface JobApplicationResult {
  status: 'applied' | 'review_required' | 'failed' | 'skipped';
  message: string;
  logs: string[];
  finalUrl: string;
  steps: number;
  artifacts: ApplicationArtifact[];
  applicationSnapshot: ApplicationSnapshot;
}

class ExternalWebsiteBlockedError extends Error {
  blockedUrl: string;

  constructor(blockedUrl: string) {
    super(
      `Skipped auto-apply because the application moved to an external website: ${blockedUrl}. ` +
        'Set APPLY_AGENT_ALLOW_EXTERNAL_WEBSITES=true to allow it again.'
    );
    this.name = 'ExternalWebsiteBlockedError';
    this.blockedUrl = blockedUrl;
  }
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

const normalizeCoverLetterText = (value: string): string => {
  const normalized = value.normalize('NFKC');
  const asciiPunctuation = normalized
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  const withoutInvisible = asciiPunctuation.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g,
    ''
  );

  return compactText(withoutInvisible, 900);
};

const isCoverLetterFieldKind = (fieldKind: string): boolean =>
  fieldKind === 'cover_letter' || fieldKind === 'motivation';

const tokenizeResumeScoringText = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !RESUME_SCORING_STOP_WORDS.has(token));

const extractJobKeywords = (job: Job): string[] => {
  const titleTokens = tokenizeResumeScoringText(job.title);
  const tokenCounts = new Map<string, number>();

  tokenizeResumeScoringText(`${job.title} ${job.company} ${job.description}`).forEach(token => {
    const titleBoost = titleTokens.includes(token) ? 3 : 0;
    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1 + titleBoost);
  });

  return Array.from(tokenCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, 45);
};

const scoreTextAgainstKeywords = (value: string, keywords: string[]): number => {
  const normalized = value.toLowerCase();
  return keywords.reduce((score, keyword) => {
    if (!normalized.includes(keyword)) {
      return score;
    }

    return score + (keyword.length > 6 ? 2 : 1);
  }, 0);
};

const scoreResumeForJob = (
  resume: Resume,
  job: Job,
  applicationProfile?: ApplicationProfile
): number => {
  const keywords = extractJobKeywords(job);
  const profileText = [
    applicationProfile?.professionalSummary,
    applicationProfile?.skillsDetails,
    applicationProfile?.previousJobsDetails,
    applicationProfile?.educationDetails,
    applicationProfile?.employerQuestionNotes
  ]
    .filter(Boolean)
    .join(' ');

  return scoreTextAgainstKeywords(`${resume.content} ${profileText}`, keywords);
};

const normalizeComparable = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  const normalized = (value || '').trim();
  return normalized ? normalized : undefined;
};

const getPreferredProfileText = (
  profileValue: string | undefined,
  fallbackValue: string | undefined
): string | undefined => normalizeOptionalText(profileValue) || normalizeOptionalText(fallbackValue);

const getProfileFullName = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined => getPreferredProfileText(applicationProfile?.fullName, candidateProfile.fullName);

const getProfileFirstName = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined => {
  const explicitFullName = normalizeOptionalText(applicationProfile?.fullName);
  if (explicitFullName) {
    return explicitFullName.split(/\s+/)[0];
  }

  return candidateProfile.firstName;
};

const getProfileLastName = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined => {
  const explicitFullName = normalizeOptionalText(applicationProfile?.fullName);
  if (explicitFullName) {
    const nameParts = explicitFullName.split(/\s+/).filter(Boolean);
    return nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined;
  }

  return candidateProfile.lastName;
};

const getProfileEmail = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined => getPreferredProfileText(applicationProfile?.email, candidateProfile.email);

const getProfilePhone = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined => getPreferredProfileText(applicationProfile?.phone, candidateProfile.phone);

const getProfileLinkedin = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined => getPreferredProfileText(applicationProfile?.linkedinUrl, candidateProfile.linkedin);

const getProfileGithub = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined => getPreferredProfileText(applicationProfile?.githubUrl, candidateProfile.github);

const getProfileWebsite = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined =>
  getPreferredProfileText(applicationProfile?.portfolioUrl, candidateProfile.website) ||
  getProfileGithub(candidateProfile, applicationProfile) ||
  getProfileLinkedin(candidateProfile, applicationProfile);

const getProfileLocation = (applicationProfile?: ApplicationProfile): string | undefined =>
  normalizeOptionalText(applicationProfile?.currentLocation);

const getProfileNoticePeriod = (applicationProfile?: ApplicationProfile): string | undefined =>
  normalizeOptionalText(applicationProfile?.noticePeriod);

const getProfileAvailability = (applicationProfile?: ApplicationProfile): string | undefined =>
  normalizeOptionalText(applicationProfile?.availability);

const getProfileProfessionalSummary = (applicationProfile?: ApplicationProfile): string | undefined =>
  normalizeOptionalText(applicationProfile?.professionalSummary);

const getProfileSkillsDetails = (applicationProfile?: ApplicationProfile): string | undefined =>
  normalizeOptionalText(applicationProfile?.skillsDetails);

const getProfilePreviousJobsDetails = (applicationProfile?: ApplicationProfile): string | undefined =>
  normalizeOptionalText(applicationProfile?.previousJobsDetails);

const getProfileEducationDetails = (applicationProfile?: ApplicationProfile): string | undefined =>
  normalizeOptionalText(applicationProfile?.educationDetails);

const getWorkRightsAnswer = (applicationProfile?: ApplicationProfile): string | undefined => {
  if (!applicationProfile) {
    return undefined;
  }

  switch (applicationProfile.workRightsStatus) {
    case 'australian_citizen_or_permanent_resident':
      return 'Australian citizen or permanent resident with full work rights.';
    case 'temporary_visa_with_work_rights':
      return normalizeOptionalText(applicationProfile.workRightsDetails)
        ? `Temporary visa with current work rights. ${applicationProfile.workRightsDetails.trim()}`
        : 'Temporary visa with current work rights.';
    case 'require_employer_sponsorship':
      return normalizeOptionalText(applicationProfile.workRightsDetails)
        ? `Requires employer sponsorship. ${applicationProfile.workRightsDetails.trim()}`
        : 'Requires employer sponsorship.';
    case 'other':
      return normalizeOptionalText(applicationProfile.workRightsDetails);
    default:
      return normalizeOptionalText(applicationProfile.workRightsDetails);
  }
};

const getDriversLicenceAnswer = (applicationProfile?: ApplicationProfile): string | undefined => {
  if (!applicationProfile) {
    return undefined;
  }

  switch (applicationProfile.driversLicenceStatus) {
    case 'full':
      return 'Full driver licence.';
    case 'provisional_or_learner':
      return 'Provisional or learner driver licence.';
    case 'none':
      return 'No driver licence.';
    default:
      return undefined;
  }
};

const getCarAccessAnswer = (applicationProfile?: ApplicationProfile): string | undefined => {
  if (!applicationProfile) {
    return undefined;
  }

  switch (applicationProfile.carAccessStatus) {
    case 'regular_access':
      return 'Yes, regular access to a car.';
    case 'no_regular_access':
      return 'No regular access to a car.';
    default:
      return undefined;
  }
};

const hasCarAccessHint = (value: string): boolean => {
  const normalized = value.toLowerCase();

  return (
    normalized.includes('regular access to a car') ||
    normalized.includes('access to a car') ||
    normalized.includes('have a car') ||
    normalized.includes('own car') ||
    normalized.includes('access to a vehicle') ||
    normalized.includes('regular access to a vehicle') ||
    normalized.includes('own vehicle') ||
    normalized.includes('reliable transport') ||
    normalized.includes('own transport') ||
    normalized.includes('personal transport')
  );
};

const hasSkillsDetailsHint = (value: string): boolean => {
  const normalized = value.toLowerCase();

  return (
    normalized.includes('technical skills') ||
    normalized.includes('key skills') ||
    normalized.includes('core skills') ||
    normalized.includes('skills and experience') ||
    normalized.includes('technologies') ||
    normalized.includes('technology stack') ||
    normalized.includes('tech stack') ||
    normalized.includes('tools') ||
    normalized.includes('competencies') ||
    normalized.includes('proficiencies') ||
    normalized.includes('expertise')
  );
};

const hasPreviousJobsHint = (value: string): boolean => {
  const normalized = value.toLowerCase();

  return (
    normalized.includes('previous job') ||
    normalized.includes('previous role') ||
    normalized.includes('work history') ||
    normalized.includes('employment history') ||
    normalized.includes('career history') ||
    normalized.includes('work experience') ||
    normalized.includes('employment details') ||
    normalized.includes('recent employer') ||
    normalized.includes('current employer')
  );
};

const hasEducationHint = (value: string): boolean => {
  const normalized = value.toLowerCase();

  return (
    normalized.includes('education') ||
    normalized.includes('qualification') ||
    normalized.includes('qualifications') ||
    normalized.includes('degree') ||
    normalized.includes('diploma') ||
    normalized.includes('certificate') ||
    normalized.includes('certification') ||
    normalized.includes('course') ||
    normalized.includes('study') ||
    normalized.includes('academic')
  );
};

const buildApplicationProfileContext = (applicationProfile?: ApplicationProfile) => {
  if (!applicationProfile) {
    return null;
  }

  return {
    fullName: normalizeOptionalText(applicationProfile.fullName) || null,
    email: normalizeOptionalText(applicationProfile.email) || null,
    phone: normalizeOptionalText(applicationProfile.phone) || null,
    currentLocation: getProfileLocation(applicationProfile) || null,
    linkedinUrl: normalizeOptionalText(applicationProfile.linkedinUrl) || null,
    portfolioUrl: normalizeOptionalText(applicationProfile.portfolioUrl) || null,
    githubUrl: normalizeOptionalText(applicationProfile.githubUrl) || null,
    noticePeriod: getProfileNoticePeriod(applicationProfile) || null,
    availability: getProfileAvailability(applicationProfile) || null,
    professionalSummary: getProfileProfessionalSummary(applicationProfile) || null,
    skillsDetails: getProfileSkillsDetails(applicationProfile) || null,
    previousJobsDetails: getProfilePreviousJobsDetails(applicationProfile) || null,
    educationDetails: getProfileEducationDetails(applicationProfile) || null,
    workRightsStatus: applicationProfile.workRightsStatus || null,
    workRightsAnswer: getWorkRightsAnswer(applicationProfile) || null,
    workRightsDetails: normalizeOptionalText(applicationProfile.workRightsDetails) || null,
    driversLicenceStatus: applicationProfile.driversLicenceStatus || null,
    driversLicenceAnswer: getDriversLicenceAnswer(applicationProfile) || null,
    carAccessStatus: applicationProfile.carAccessStatus || null,
    carAccessAnswer: getCarAccessAnswer(applicationProfile) || null,
    salaryExpectationAnnual: normalizeOptionalText(applicationProfile.salaryExpectationAnnual) || null,
    employerQuestionNotes: normalizeOptionalText(applicationProfile.employerQuestionNotes) || null
  };
};

const buildSkillsDetailsText = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined =>
  getProfileSkillsDetails(applicationProfile) ||
  candidateProfile.skills.filter(Boolean).slice(0, 12).join(', ') ||
  undefined;

const buildPreviousJobsDetailsText = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined =>
  getProfilePreviousJobsDetails(applicationProfile) ||
  candidateProfile.experienceHighlights
    .filter(Boolean)
    .slice(0, 4)
    .join(' ') ||
  undefined;

const buildEducationDetailsText = (
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string | undefined =>
  getProfileEducationDetails(applicationProfile) ||
  candidateProfile.educationHighlights
    .filter(Boolean)
    .slice(0, 4)
    .join(' ') ||
  undefined;

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

const buildCoverLetterText = (
  job: Job,
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string => {
  const manualSkillsDetails = getProfileSkillsDetails(applicationProfile);
  const manualPreviousJobsDetails = getProfilePreviousJobsDetails(applicationProfile);
  const companyName = normalizeOptionalText(job.company) || 'your team';
  const roleTitle = normalizeOptionalText(job.title) || 'role';
  const topSkills = candidateProfile.skills.filter(Boolean).slice(0, 4);
  const skillsText =
    manualSkillsDetails
      ? compactText(manualSkillsDetails, 220)
      : topSkills.length > 0
      ? topSkills.join(', ')
      : 'software delivery, stakeholder collaboration, and problem solving';
  const profileSummary = getProfileProfessionalSummary(applicationProfile);
  const experienceText = manualPreviousJobsDetails
    ? compactText(manualPreviousJobsDetails, 260)
    : candidateProfile.experienceHighlights
        .filter(Boolean)
        .slice(0, 2)
        .map(item => compactText(item, 160))
        .join(' ');
  const yearsText = candidateProfile.estimatedCareerYears
    ? ` Over the past ${candidateProfile.estimatedCareerYears} years, I have built hands-on experience in ${skillsText}.`
    : ` My background is strongest in ${skillsText}.`;
  const detailText = experienceText
    ? ` Recent work includes ${experienceText}.`
    : profileSummary
    ? ` ${compactText(profileSummary, 220)}`
    : '';

  return normalizeCoverLetterText(
    `The ${roleTitle} role at ${companyName} stood out to me because it matches the kind of work I enjoy most.${yearsText}` +
      `${detailText} I like working with people, staying practical, and following through on the details. ` +
      `I would love the chance to bring that approach to ${companyName}.`
  );
};

export const buildApplicationSnapshot = (
  job: Job,
  resume: Resume,
  overrides?: Partial<Pick<ApplicationSnapshot, 'coverLetterText' | 'coverLetterUsed'>>
): ApplicationSnapshot => {
  const candidateProfile = extractCandidateProfile(resume);

  return {
    resumeId: resume.id,
    resumeFileName: resume.fileName,
    resumeContent: resume.content,
    resumeIsTailored: false,
    resumeSourceFileName: resume.fileName,
    coverLetterText: overrides?.coverLetterText ?? buildCoverLetterText(job, candidateProfile),
    coverLetterUsed: overrides?.coverLetterUsed ?? false
  };
};

const buildApplicationSnapshotFromOption = (
  job: Job,
  resumeOption: ResumeOption,
  overrides?: Partial<Pick<ApplicationSnapshot, 'coverLetterText' | 'coverLetterUsed'>>
): ApplicationSnapshot => buildApplicationSnapshot(job, resumeOption.resume, overrides);

const buildCandidateSummaryText = (
  job: Job,
  candidateProfile: CandidateProfile,
  applicationProfile?: ApplicationProfile
): string => {
  const profileSummary = getProfileProfessionalSummary(applicationProfile);
  if (profileSummary) {
    return compactText(profileSummary, 420);
  }

  const manualProfileDetails = [
    getProfileSkillsDetails(applicationProfile),
    getProfilePreviousJobsDetails(applicationProfile),
    getProfileEducationDetails(applicationProfile)
  ]
    .filter(Boolean)
    .map(detail => compactText(detail as string, 160))
    .join(' ');

  if (manualProfileDetails) {
    return compactText(manualProfileDetails, 420);
  }

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

const buildResumePromptEntry = (
  resume: Resume,
  candidateProfile: CandidateProfile,
  resumeRef: string
): ResumeLibraryEntry => ({
  resumeRef,
  fileName: resume.fileName,
  fileType: resume.fileType,
  uploadedAt: resume.uploadedAt,
  skills: candidateProfile.skills.slice(0, 10),
  experienceHighlights: candidateProfile.experienceHighlights.slice(0, 6),
  educationHighlights: candidateProfile.educationHighlights.slice(0, 4),
  estimatedCareerYears: candidateProfile.estimatedCareerYears,
  resumeSummary: compactText(candidateProfile.resumeSummary, 1600)
});

const buildResumeOption = (
  resume: Resume,
  resumeRef: string,
  options?: ResumeOptionBuildOptions
): ResumeOption => {
  const candidateProfile = extractCandidateProfile(resume);
  return {
    resumeRef,
    resume,
    candidateProfile,
    filePath: options?.filePath || resolveResumeFilePath(resume),
    promptEntry: buildResumePromptEntry(resume, candidateProfile, resumeRef)
  };
};

const buildSourceResumeOptions = (primaryResume: Resume): Resume[] => {
  return listStoredResumes()
    .filter(storedResume => {
      if (storedResume.id === primaryResume.id) {
        return false;
      }

      if (
        primaryResume.storedFileName &&
        storedResume.storedFileName &&
        storedResume.storedFileName === primaryResume.storedFileName
      ) {
        return false;
      }

      return true;
    })
    .slice(0, 6);
};

const buildAvailableResumeOptions = async (
  job: Job,
  primaryResume: Resume,
  applicationProfile: ApplicationProfile | undefined
): Promise<AvailableResumeOptionsResult> => {
  const selectionLogs: string[] = [];
  const sourceResumes = [primaryResume, ...buildSourceResumeOptions(primaryResume)]
    .map((resume, index) => ({
      resume,
      originalIndex: index,
      score: scoreResumeForJob(resume, job, applicationProfile)
    }))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex)
    .map(entry => entry.resume);

  const originalOptions: ResumeOption[] = [];
  sourceResumes.forEach((sourceResume, index) => {
    try {
      originalOptions.push(buildResumeOption(sourceResume, `resume_${index + 1}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown resume file error';
      selectionLogs.push(`Uploaded resume "${sourceResume.fileName}" is not directly uploadable: ${message}`);
    }
  });

  if (originalOptions.length > 0) {
    selectionLogs.push(
      `Selected uploaded resume "${originalOptions[0].resume.fileName}" as the most relevant resume for ${job.company} - ${job.title}.`
    );
  }

  return {
    options: originalOptions,
    selectionLogs
  };
};

const getResumeLibraryContext = (
  activeResumeOption: ResumeOption,
  availableResumeOptions: ResumeOption[]
): ResumeLibraryEntry[] =>
  availableResumeOptions
    .filter(option => option.resumeRef !== activeResumeOption.resumeRef)
    .map(option => option.promptEntry);

const resolveResumeOptionForUpload = (
  resumeRef: string | undefined,
  activeResumeOption: ResumeOption,
  availableResumeOptionsByRef: Map<string, ResumeOption>
): ResumeOption => {
  if (!resumeRef) {
    return activeResumeOption;
  }

  const normalizedResumeRef = resumeRef.trim().toLowerCase();
  if (!normalizedResumeRef) {
    return activeResumeOption;
  }

  const requestedResumeOption = availableResumeOptionsByRef.get(normalizedResumeRef);
  if (!requestedResumeOption) {
    throw new Error(
      `LLM upload_resume action referenced unknown resumeRef "${resumeRef}". Available resumeRefs: ${Array.from(
        availableResumeOptionsByRef.values()
      )
        .map(option => option.resumeRef)
        .join(', ')}.`
    );
  }

  return requestedResumeOption;
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

    const activeElement = document.activeElement as HTMLElement | null;

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
        value:
          'value' in input
            ? (input.type || '').toLowerCase() === 'password'
              ? input.value
                ? '__redacted_password_present__'
                : ''
              : clean(input.value, 200)
            : null,
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
        focused: activeElement === element,
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

    const activeSnapshotElement = elements.find(element => element.focused);
    const activeElementId = activeSnapshotElement?.id;
    const activeElementSummary = activeSnapshotElement
      ? clean(
          `${activeSnapshotElement.label || activeSnapshotElement.name || activeSnapshotElement.placeholder || activeSnapshotElement.tag} (${activeSnapshotElement.type || activeSnapshotElement.tag})`,
          160
        )
      : clean(
          activeElement
            ? `${activeElement.getAttribute('aria-label') || activeElement.getAttribute('name') || activeElement.tagName.toLowerCase()}`
            : '',
          160
        ) || undefined;

    return {
      title: document.title,
      url: window.location.href,
      visibleText: clean(document.body?.innerText || '', maxVisibleTextChars),
      validationMessages,
      activeElementId,
      activeElementSummary,
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
    resumeRef: typeof decision.resumeRef === 'string' ? decision.resumeRef.trim() : undefined,
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

const getActiveEditableElement = (snapshot: PageSnapshot): PageElementSnapshot | undefined => {
  if (!snapshot.activeElementId) {
    return undefined;
  }

  const activeElement = getSnapshotElement(snapshot, snapshot.activeElementId);
  if (!activeElement?.editable || activeElement.disabled || activeElement.hidden) {
    return undefined;
  }

  return activeElement;
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
  | 'location'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'notice_period'
  | 'availability'
  | 'work_rights'
  | 'drivers_licence'
  | 'car_access'
  | 'skills_details'
  | 'previous_jobs_details'
  | 'education_details'
  | 'salary_expectation'
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
  if (
    combinedHints.includes('location') ||
    combinedHints.includes('address') ||
    combinedHints.includes('suburb') ||
    combinedHints.includes('postcode') ||
    combinedHints.includes('city') ||
    combinedHints.includes('state')
  ) {
    return 'location';
  }
  if (combinedHints.includes('linkedin')) return 'linkedin';
  if (combinedHints.includes('github')) return 'github';
  if (combinedHints.includes('website') || combinedHints.includes('portfolio') || combinedHints.includes('url')) return 'website';
  if (combinedHints.includes('notice period') || combinedHints.includes('notice')) return 'notice_period';
  if (
    combinedHints.includes('availability') ||
    combinedHints.includes('available to start') ||
    combinedHints.includes('when can you start') ||
    combinedHints.includes('start date')
  ) {
    return 'availability';
  }
  if (
    combinedHints.includes('work rights') ||
    combinedHints.includes('working rights') ||
    combinedHints.includes('right to work') ||
    combinedHints.includes('work authorization') ||
    combinedHints.includes('work authorisation') ||
    combinedHints.includes('sponsorship') ||
    combinedHints.includes('work visa')
  ) {
    return 'work_rights';
  }
  if (hasSkillsDetailsHint(combinedHints)) {
    return 'skills_details';
  }
  if (hasPreviousJobsHint(combinedHints)) {
    return 'previous_jobs_details';
  }
  if (hasEducationHint(combinedHints)) {
    return 'education_details';
  }
  if (hasCarAccessHint(combinedHints)) {
    return 'car_access';
  }
  if (
    combinedHints.includes('driver') ||
    combinedHints.includes("driver's licence") ||
    combinedHints.includes("driver's license") ||
    combinedHints.includes('drivers licence') ||
    combinedHints.includes('drivers license') ||
    combinedHints.includes('licence') ||
    combinedHints.includes('license')
  ) {
    return 'drivers_licence';
  }
  if (
    combinedHints.includes('salary') ||
    combinedHints.includes('base salary') ||
    combinedHints.includes('expected pay') ||
    combinedHints.includes('compensation') ||
    combinedHints.includes('remuneration')
  ) {
    return 'salary_expectation';
  }
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
    case 'location':
      return (
        hints.includes('location') ||
        hints.includes('address') ||
        hints.includes('suburb') ||
        hints.includes('postcode') ||
        hints.includes('city') ||
        hints.includes('state')
      );
    case 'linkedin':
      return hints.includes('linkedin');
    case 'github':
      return hints.includes('github');
    case 'website':
      return hints.includes('website') || hints.includes('portfolio') || hints.includes('url');
    case 'notice_period':
      return hints.includes('notice period') || hints.includes('notice');
    case 'availability':
      return (
        hints.includes('availability') ||
        hints.includes('available to start') ||
        hints.includes('when can you start') ||
        hints.includes('start date')
      );
    case 'work_rights':
      return (
        hints.includes('work rights') ||
        hints.includes('working rights') ||
        hints.includes('right to work') ||
        hints.includes('sponsorship') ||
        hints.includes('visa')
      );
    case 'skills_details':
      return hasSkillsDetailsHint(hints);
    case 'previous_jobs_details':
      return hasPreviousJobsHint(hints);
    case 'education_details':
      return hasEducationHint(hints);
    case 'drivers_licence':
      return (
        hints.includes('driver') ||
        hints.includes('licence') ||
        hints.includes('license')
      );
    case 'car_access':
      return hasCarAccessHint(hints);
    case 'salary_expectation':
      return (
        hints.includes('salary') ||
        hints.includes('base salary') ||
        hints.includes('compensation') ||
        hints.includes('remuneration') ||
        hints.includes('pay')
      );
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
  const activeEditableElement = getActiveEditableElement(snapshot);
  if (!decision.targetId && activeEditableElement) {
    return activeEditableElement.id;
  }

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
  job: Job,
  applicationProfile?: ApplicationProfile
): string | undefined => {
  switch (fieldKind) {
    case 'email':
      return getProfileEmail(candidateProfile, applicationProfile);
    case 'phone':
      return getProfilePhone(candidateProfile, applicationProfile);
    case 'first_name':
      return getProfileFirstName(candidateProfile, applicationProfile);
    case 'last_name':
      return getProfileLastName(candidateProfile, applicationProfile);
    case 'full_name':
      return getProfileFullName(candidateProfile, applicationProfile);
    case 'location':
      return getProfileLocation(applicationProfile);
    case 'linkedin':
      return getProfileLinkedin(candidateProfile, applicationProfile);
    case 'github':
      return getProfileGithub(candidateProfile, applicationProfile);
    case 'website':
      return getProfileWebsite(candidateProfile, applicationProfile);
    case 'notice_period':
      return getProfileNoticePeriod(applicationProfile);
    case 'availability':
      return getProfileAvailability(applicationProfile);
    case 'work_rights':
      return getWorkRightsAnswer(applicationProfile);
    case 'skills_details':
      return buildSkillsDetailsText(candidateProfile, applicationProfile);
    case 'previous_jobs_details':
      return buildPreviousJobsDetailsText(candidateProfile, applicationProfile);
    case 'education_details':
      return buildEducationDetailsText(candidateProfile, applicationProfile);
    case 'drivers_licence':
      return getDriversLicenceAnswer(applicationProfile);
    case 'car_access':
      return getCarAccessAnswer(applicationProfile);
    case 'salary_expectation':
      return normalizeOptionalText(applicationProfile?.salaryExpectationAnnual);
    case 'cover_letter':
    case 'motivation':
      return buildCoverLetterText(job, candidateProfile, applicationProfile);
    case 'summary':
      return buildCandidateSummaryText(job, candidateProfile, applicationProfile);
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
  job: Job,
  applicationProfile?: ApplicationProfile
): string | undefined => {
  if (decision.action !== 'type') {
    return decision.text;
  }

  if (typeof decision.text === 'string' && decision.text.trim()) {
    return decision.text;
  }

  const fieldKind = inferFieldKind(decision, snapshot);
  const element = getSnapshotElement(snapshot, decision.targetId) || getActiveEditableElement(snapshot);
  if (!element) {
    return getCandidateValueForFieldKind(fieldKind, candidateProfile, job, applicationProfile);
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
    return getProfileEmail(candidateProfile, applicationProfile);
  }

  if (
    element.type === 'tel' ||
    hints.includes('phone') ||
    hints.includes('mobile') ||
    hints.includes('contact number')
  ) {
    return getProfilePhone(candidateProfile, applicationProfile);
  }

  if (hints.includes('first name') || hints.includes('given name') || hints.includes('forename')) {
    return getProfileFirstName(candidateProfile, applicationProfile);
  }

  if (hints.includes('last name') || hints.includes('surname') || hints.includes('family name')) {
    return getProfileLastName(candidateProfile, applicationProfile);
  }

  if (hints.includes('full name') || hints.includes('your name') || hints === 'name') {
    return getProfileFullName(candidateProfile, applicationProfile);
  }

  if (
    hints.includes('location') ||
    hints.includes('address') ||
    hints.includes('suburb') ||
    hints.includes('postcode') ||
    hints.includes('city') ||
    hints.includes('state')
  ) {
    return getProfileLocation(applicationProfile);
  }

  if (hints.includes('linkedin')) {
    return getProfileLinkedin(candidateProfile, applicationProfile);
  }

  if (hints.includes('github')) {
    return getProfileGithub(candidateProfile, applicationProfile);
  }

  if (
    hints.includes('website') ||
    hints.includes('portfolio') ||
    hints.includes('personal site') ||
    hints.includes('url')
  ) {
    return getProfileWebsite(candidateProfile, applicationProfile);
  }

  if (hints.includes('notice period') || hints.includes('notice')) {
    return getProfileNoticePeriod(applicationProfile);
  }

  if (
    hints.includes('availability') ||
    hints.includes('available to start') ||
    hints.includes('when can you start') ||
    hints.includes('start date')
  ) {
    return getProfileAvailability(applicationProfile);
  }

  if (
    hints.includes('work rights') ||
    hints.includes('working rights') ||
    hints.includes('right to work') ||
    hints.includes('authorisation') ||
    hints.includes('authorization') ||
    hints.includes('sponsorship') ||
    hints.includes('visa')
  ) {
    return getWorkRightsAnswer(applicationProfile);
  }

  if (hasSkillsDetailsHint(hints)) {
    return buildSkillsDetailsText(candidateProfile, applicationProfile);
  }

  if (hasPreviousJobsHint(hints)) {
    return buildPreviousJobsDetailsText(candidateProfile, applicationProfile);
  }

  if (hasEducationHint(hints)) {
    return buildEducationDetailsText(candidateProfile, applicationProfile);
  }

  if (hasCarAccessHint(hints)) {
    return getCarAccessAnswer(applicationProfile);
  }

  if (
    hints.includes('driver') ||
    hints.includes('licence') ||
    hints.includes('license')
  ) {
    return getDriversLicenceAnswer(applicationProfile);
  }

  if (
    hints.includes('salary') ||
    hints.includes('base salary') ||
    hints.includes('expected pay') ||
    hints.includes('compensation') ||
    hints.includes('remuneration')
  ) {
    return normalizeOptionalText(applicationProfile?.salaryExpectationAnnual);
  }

  if (hints.includes('cover letter') || hints.includes('covering letter')) {
    return buildCoverLetterText(job, candidateProfile, applicationProfile);
  }

  if (
    hints.includes('why are you interested') ||
    hints.includes('why do you want') ||
    hints.includes('motivation') ||
    hints.includes('why this role')
  ) {
    return buildCoverLetterText(job, candidateProfile, applicationProfile);
  }

  if (
    hints.includes('about you') ||
    hints.includes('summary') ||
    hints.includes('profile') ||
    hints.includes('introduction')
  ) {
    return buildCandidateSummaryText(job, candidateProfile, applicationProfile);
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
    return getProfileFullName(candidateProfile, applicationProfile);
  }

  return getCandidateValueForFieldKind(fieldKind, candidateProfile, job, applicationProfile);
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
  snapshot: PageSnapshot,
  applicationProfile?: ApplicationProfile
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
  if (FORCE_CONTINUE_REVIEW_PATTERN.test(combinedReason)) {
    return true;
  }

  if (!COMMON_APPLICATION_PROFILE_REVIEW_PATTERN.test(combinedReason)) {
    return false;
  }

  const normalizedReason = combinedReason.toLowerCase();
  if (
    (normalizedReason.includes('work rights') ||
      normalizedReason.includes('working rights') ||
      normalizedReason.includes('right to work') ||
      normalizedReason.includes('authorisation') ||
      normalizedReason.includes('authorization') ||
      normalizedReason.includes('sponsorship')) &&
    getWorkRightsAnswer(applicationProfile)
  ) {
    return true;
  }

  if (
    (normalizedReason.includes('driver') ||
      normalizedReason.includes('licence') ||
      normalizedReason.includes('license')) &&
    getDriversLicenceAnswer(applicationProfile)
  ) {
    return true;
  }

  if (hasCarAccessHint(normalizedReason) && getCarAccessAnswer(applicationProfile)) {
    return true;
  }

  if (hasSkillsDetailsHint(normalizedReason) && getProfileSkillsDetails(applicationProfile)) {
    return true;
  }

  if (hasPreviousJobsHint(normalizedReason) && getProfilePreviousJobsDetails(applicationProfile)) {
    return true;
  }

  if (hasEducationHint(normalizedReason) && getProfileEducationDetails(applicationProfile)) {
    return true;
  }

  if (
    (normalizedReason.includes('salary') ||
      normalizedReason.includes('base salary') ||
      normalizedReason.includes('compensation') ||
      normalizedReason.includes('remuneration')) &&
    normalizeOptionalText(applicationProfile?.salaryExpectationAnnual)
  ) {
    return true;
  }

  if (
    (normalizedReason.includes('notice') || normalizedReason.includes('start date')) &&
    getProfileNoticePeriod(applicationProfile)
  ) {
    return true;
  }

  if (
    (normalizedReason.includes('availability') || normalizedReason.includes('available to start')) &&
    getProfileAvailability(applicationProfile)
  ) {
    return true;
  }

  if (
    (normalizedReason.includes('location') ||
      normalizedReason.includes('address') ||
      normalizedReason.includes('suburb') ||
      normalizedReason.includes('postcode')) &&
    getProfileLocation(applicationProfile)
  ) {
    return true;
  }

  if (
    (normalizedReason.includes('summary') ||
      normalizedReason.includes('about you') ||
      normalizedReason.includes('profile')) &&
    getProfileProfessionalSummary(applicationProfile)
  ) {
    return true;
  }

  if (
    (normalizedReason.includes('email') ||
      normalizedReason.includes('phone') ||
      normalizedReason.includes('mobile') ||
      normalizedReason.includes('name') ||
      normalizedReason.includes('linkedin') ||
      normalizedReason.includes('github') ||
      normalizedReason.includes('website') ||
      normalizedReason.includes('portfolio')) &&
    (
      normalizeOptionalText(applicationProfile?.fullName) ||
      normalizeOptionalText(applicationProfile?.email) ||
      normalizeOptionalText(applicationProfile?.phone) ||
      normalizeOptionalText(applicationProfile?.linkedinUrl) ||
      normalizeOptionalText(applicationProfile?.githubUrl) ||
      normalizeOptionalText(applicationProfile?.portfolioUrl)
    )
  ) {
    return true;
  }

  return Boolean(normalizeOptionalText(applicationProfile?.employerQuestionNotes));
};

const planNextAction = async (
  job: Job,
  activeResumeOption: ResumeOption,
  availableResumeOptions: ResumeOption[],
  applicationProfile: ApplicationProfile | undefined,
  snapshot: PageSnapshot,
  logs: string[],
  extraInstruction?: string,
  attemptFeedback?: string
): Promise<AgentDecision> => {
  const openai = getOpenAIClient();
  const candidateProfile = activeResumeOption.candidateProfile;
  const activeResume = activeResumeOption.promptEntry;
  const resumeLibrary = getResumeLibraryContext(activeResumeOption, availableResumeOptions);
  const applicationProfileContext = buildApplicationProfileContext(applicationProfile);

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
            'Use applicationProfile for explicit user-provided contact details, links, location, notice period, availability, professional summary, manual skills, previous jobs, education details, common employer questions, car access, and recurring screening notes. If applicationProfile contains the needed answer, continue the application instead of stopping for review. ' +
            'If a required employer question asks for years of experience or skill exposure, infer a conservative estimate from the resume evidence and choose the lowest supported answer rather than stopping. ' +
            'Use activeResume as the current primary source of truth. It is the most relevant uploaded resume for this job. You may use resumeLibrary only as alternative stored uploaded resumes that you can switch to later, and you must not merge contradictory claims across resumes. ' +
            'Do not create or ask for a generated resume. Use only uploaded resume files for resume/CV uploads. ' +
            'If one of the alternative resumes is materially more relevant for this specific role, switch to it by using upload_resume with both targetId and that resumeRef. After you upload a different resume, keep later answers consistent with that uploaded resume. ' +
            'Prefer concise professional answers. ' +
            'You have a Playwright-backed browser toolset, not raw code execution. ' +
            'Use these actions only: click, double_click, hover, focus, clear, type, select, check, upload_resume, press, scroll, scroll_into_view, wait, wait_for_text, go_back, reload, done, fail. ' +
            'External employer pages, redirects, and new tabs are supported. Do not fail merely because the application leaves Seek or loads on another domain. Continue the application on the new page just like any other page. ' +
            'Only use type on elements where editable=true, select on selectable=true, check on checkable=true, upload_resume on uploadable=true, and click/double_click/hover/focus/scroll_into_view on elements that are relevant visible targets. ' +
            'Every click, double_click, hover, focus, clear, select, check, upload_resume, and scroll_into_view action must include a valid numeric targetId from the current page snapshot. ' +
            'Type actions normally include targetId, but if a field is hard to target directly, security-sensitive, or only reachable by keyboard navigation, you may use press with Tab or Shift+Tab until the desired field is focused and then use type without targetId to type into the currently focused field. ' +
            'For every type action, you must include the exact literal string to enter in the "text" field. Never omit it. ' +
            'Return exactly one JSON object and nothing else. Do not include markdown, code fences, commentary, or multiple JSON objects. ' +
            'Use clear before type when a text field already contains inaccurate, generic, or irrelevant content. ' +
            'Use hover or focus when menus, tooltips, or lazy controls need activation before clicking or typing. ' +
            'Use scroll_into_view when the needed target is off-screen or blocked by sticky layout. ' +
            'Use wait_for_text when you expect visible page text, validation copy, or a new question section to appear. ' +
            'Use page.activeElementSummary and focused elements to reason about keyboard navigation. If the focused element is the desired password or login field, you may type into it directly after tabbing. ' +
            'Treat recent verification logs as authoritative. If a recent log says a field now matches the entered text or selected option, do not rewrite that field again unless new validation messages or the latest snapshot show it is empty, invalid, or changed. ' +
            'If attemptFeedback is provided, correct that exact failure and choose a different valid action when repeating the same action would be ineffective. ' +
            'Use page.validationMessages, element.invalid, element.value, and element.selectedOption to correct blocked or prefilled fields before giving up. ' +
            'Treat current input values, selected options, checked states, resume uploads, and cover-letter drafts as editable drafts that must be verified and corrected when inaccurate, generic, or mismatched. ' +
            'If a resume or CV upload field is visible and the application expects one, use upload_resume to attach the most relevant available uploaded resume. Prefer switching resumes before answering detailed experience, profile, or motivation questions when that keeps the answers consistent with the uploaded resume. ' +
            'If a cover-letter or motivation field is visible, write a concise tailored answer grounded in the resume and job description. Keep it warm, natural, and human in first person. Avoid AI-sounding phrasing, cliches, stiff corporate language, em dashes, and hidden formatting characters. ' +
            'Use done only when the application is submitted or the page clearly shows a confirmation or only non-essential follow-up remains. ' +
            'Use finalStatus=review_required only for captcha, MFA, legal declarations not supported by the resume, or truly missing personal information that is not already supplied by applicationProfile and cannot be conservatively inferred. ' +
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
              applicationProfile: applicationProfileContext,
              activeResume,
              candidateProfile,
              resumeLibrary,
              resumeSummary: compactText(activeResumeOption.resume.content, MAX_RESUME_CHARS),
              page: snapshot,
              recentLogs: logs.slice(-8),
              extraInstruction: extraInstruction || null,
              attemptFeedback: attemptFeedback || null,
              outputSchema: {
                reasoning: 'string',
                action:
                  'click | double_click | hover | focus | clear | type | select | check | upload_resume | press | scroll | scroll_into_view | wait | wait_for_text | go_back | reload | done | fail',
                targetId: 'number when targeting an element; optional for type when typing into the currently focused field after keyboard navigation',
                resumeRef:
                  'optional string for upload_resume actions when choosing a specific resume from activeResume or resumeLibrary; omit it to keep using the current activeResume',
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

const prepareTargetLocator = async (
  page: Page,
  targetId: number,
  options?: { requireVisible?: boolean }
) => {
  const locator = getTargetLocator(page, targetId);
  await locator.waitFor({ state: 'attached', timeout: 5000 });
  if (options?.requireVisible === false) {
    return locator;
  }
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

const resolveUploadTargetId = (
  snapshot: PageSnapshot,
  decision: AgentDecision
): number | undefined => {
  const requestedTarget = getSnapshotElement(snapshot, decision.targetId);
  if (requestedTarget?.uploadable && !requestedTarget.disabled) {
    return requestedTarget.id;
  }

  const uploadableElements = snapshot.elements.filter(element => element.uploadable && !element.disabled);
  if (uploadableElements.length === 0) {
    return undefined;
  }

  const rankUploadTarget = (element: PageElementSnapshot): number => {
    const hints = `${getElementHints(element)} ${decision.message || ''} ${decision.reasoning || ''}`;
    let score = 0;

    if (/resume|cv|curriculum vitae/.test(hints)) {
      score += 5;
    }
    if (/upload|attach/.test(hints)) {
      score += 3;
    }
    if (/(pdf|doc|docx)/.test((element.accept || '').toLowerCase())) {
      score += 2;
    }

    return score;
  };

  return uploadableElements
    .slice()
    .sort((left, right) => {
      const scoreDifference = rankUploadTarget(right) - rankUploadTarget(left);
      return scoreDifference !== 0 ? scoreDifference : left.id - right.id;
    })[0]?.id;
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

const typeIntoFocusedElement = async (page: Page, text: string): Promise<void> => {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');

  if (text.length <= SEQUENTIAL_TYPE_MAX_CHARS) {
    await page.keyboard.type(text, { delay: HUMAN_TYPING_DELAY_MS });
  } else {
    await page.keyboard.insertText(text);
  }

  await page.waitForTimeout(200);
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

const getPageOrigin = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

const getDomainFamily = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 2) {
      return hostname;
    }

    const topLevelDomain = parts[parts.length - 1];
    const secondLevelDomain = parts[parts.length - 2];
    const hasCountryCodeSuffix = topLevelDomain.length === 2;
    const hasCommonSecondLevelDomain = ['com', 'net', 'org', 'gov', 'edu', 'asn', 'id'].includes(
      secondLevelDomain
    );

    return hasCountryCodeSuffix && hasCommonSecondLevelDomain && parts.length >= 3
      ? parts.slice(-3).join('.')
      : parts.slice(-2).join('.');
  } catch {
    return '';
  }
};

const isAllowedAutomationUrl = (url: string): boolean => {
  if (ALLOW_EXTERNAL_WEBSITE_AUTOMATION) {
    return true;
  }

  const domainFamily = getDomainFamily(url);
  if (!domainFamily) {
    return true;
  }

  return ALLOWED_AUTO_APPLY_DOMAIN_FAMILIES.includes(domainFamily);
};

const ensureAllowedAutomationUrl = (url: string): void => {
  if (!isAllowedAutomationUrl(url)) {
    throw new ExternalWebsiteBlockedError(url);
  }
};

const isExternalWebsiteBlockedError = (error: unknown): error is ExternalWebsiteBlockedError =>
  error instanceof ExternalWebsiteBlockedError;

const completeInteractivePageAction = async (
  currentPage: Page,
  action: () => Promise<void>
): Promise<{ page: Page; pageChangeMessage?: string }> => {
  const beforePages = new Set(currentPage.context().pages().filter(page => !page.isClosed()));
  const popupPromise = currentPage.waitForEvent('popup', { timeout: 4000 }).catch(() => null);

  await action();

  const popupPage = await Promise.race([
    popupPromise,
    currentPage.waitForTimeout(1200).then(() => null)
  ]);
  let nextPage = popupPage;

  if (!nextPage) {
    await currentPage.waitForTimeout(400);
    nextPage =
      currentPage
        .context()
        .pages()
        .find(page => !page.isClosed() && !beforePages.has(page)) || null;
  }

  if (nextPage) {
    try {
      await nextPage.waitForLoadState('domcontentloaded', { timeout: 15000 });
    } catch {
      // Best effort only. Some external sites keep loading while still being usable.
    }
    await settlePage(nextPage);
    ensureAllowedAutomationUrl(nextPage.url());
    try {
      await nextPage.bringToFront();
    } catch {
      // Ignore focus failures.
    }

    const message =
      getPageOrigin(nextPage.url()) !== getPageOrigin(currentPage.url())
        ? `Switched to external page: ${nextPage.url()}`
        : `Switched to new page: ${nextPage.url()}`;

    return { page: nextPage, pageChangeMessage: message };
  }

  await settlePage(currentPage);
  ensureAllowedAutomationUrl(currentPage.url());
  return { page: currentPage };
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
  const beforeElement =
    getSnapshotElement(beforeSnapshot, executedAction.targetId) ||
    (executedAction.action === 'type' || executedAction.action === 'clear'
      ? getActiveEditableElement(beforeSnapshot)
      : undefined);
  const afterElement =
    getSnapshotElement(afterSnapshot, executedAction.targetId) ||
    (executedAction.action === 'type' || executedAction.action === 'clear'
      ? getActiveEditableElement(afterSnapshot)
      : undefined);

  switch (executedAction.action) {
    case 'clear': {
      const afterValue = getElementComparableValue(afterElement);
      return afterValue.length === 0
        ? { success: true, message: `Verified target ${executedAction.targetId} is now empty.` }
        : { success: false, message: `Target ${executedAction.targetId} still contains text after clear.` };
    }
    case 'type': {
      if (afterElement?.type === 'password') {
        return afterElement.value
          ? { success: true, message: 'Verified the focused password field now contains a value.' }
          : { success: false, message: 'The focused password field still appears empty.' };
      }

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
      const uploadedResumeLabel = executedAction.resumeFileName
        ? ` "${executedAction.resumeFileName}"`
        : '';
      return !afterInvalid || (beforeInvalid && !afterInvalid)
        ? {
            success: true,
            message: `Verified the resume upload field no longer appears invalid after uploading${uploadedResumeLabel}.`
          }
        : {
            success: true,
            message: `Resume upload${uploadedResumeLabel} was attempted. Review the screenshot if the page still needs confirmation.`
          };
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
    case 'press': {
      const focusSummary = afterSnapshot.activeElementSummary
        ? ` Focus is now on ${afterSnapshot.activeElementSummary}.`
        : '';
      const changed =
        beforeSnapshot.activeElementId !== afterSnapshot.activeElementId ||
        beforeSnapshot.url !== afterSnapshot.url;
      return changed
        ? { success: true, message: `Verified keyboard navigation changed focus or page state.${focusSummary}` }
        : { success: true, message: `Keyboard input completed.${focusSummary}` };
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
  activeResumeOption: ResumeOption,
  availableResumeOptionsByRef: Map<string, ResumeOption>,
  applicationProfile: ApplicationProfile | undefined,
  snapshot: PageSnapshot,
  job: Job
): Promise<DecisionExecutionResult> => {
  switch (decision.action) {
    case 'click': {
      if (!decision.targetId) {
        throw new Error('LLM click action did not include a targetId.');
      }
      const resolved = await completeInteractivePageAction(page, async () => {
        await (await prepareTargetLocator(page, decision.targetId!)).click({ timeout: 10000 });
      });
      return {
        executedAction: { action: 'click', targetId: decision.targetId },
        page: resolved.page,
        pageChangeMessage: resolved.pageChangeMessage
      };
    }
    case 'double_click': {
      if (!decision.targetId) {
        throw new Error('LLM double_click action did not include a targetId.');
      }
      const resolved = await completeInteractivePageAction(page, async () => {
        await (await prepareTargetLocator(page, decision.targetId!)).dblclick({ timeout: 10000 });
      });
      return {
        executedAction: { action: 'double_click', targetId: decision.targetId },
        page: resolved.page,
        pageChangeMessage: resolved.pageChangeMessage
      };
    }
    case 'hover': {
      if (!decision.targetId) {
        throw new Error('LLM hover action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).hover({ timeout: 10000 });
      await page.waitForTimeout(300);
      return { executedAction: { action: 'hover', targetId: decision.targetId }, page };
    }
    case 'focus': {
      if (!decision.targetId) {
        throw new Error('LLM focus action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).focus({ timeout: 10000 });
      await page.waitForTimeout(200);
      return { executedAction: { action: 'focus', targetId: decision.targetId }, page };
    }
    case 'clear': {
      if (!decision.targetId) {
        throw new Error('LLM clear action did not include a targetId.');
      }
      await clearEditableTarget(page, decision.targetId, snapshot);
      return { executedAction: { action: 'clear', targetId: decision.targetId }, page };
    }
    case 'type': {
      const fieldKind = inferFieldKind(decision, snapshot);
      const text = resolveAutofillText(
        decision,
        snapshot,
        activeResumeOption.candidateProfile,
        job,
        applicationProfile
      );
      const typedText =
        text !== undefined && isCoverLetterFieldKind(fieldKind)
          ? normalizeCoverLetterText(text)
          : text;
      const resolvedTargetId = resolveFallbackTypeTargetId(decision, snapshot);
      if (typedText === undefined) {
        const element =
          getSnapshotElement(snapshot, resolvedTargetId || decision.targetId) ||
          getActiveEditableElement(snapshot);
        const hint = element
          ? `target "${element.label || element.name || element.placeholder || element.text || element.tag}"`
          : 'unknown target';
        throw new Error(`LLM type action did not include text and no autofill value was available for ${hint}.`);
      }
      if (!decision.targetId) {
        if (!snapshot.activeElementId && !snapshot.activeElementSummary) {
          throw new Error(
            'LLM attempted to type into the focused field, but there is no detectable focused element. Use Tab or focus first.'
          );
        }
        await typeIntoFocusedElement(page, typedText);
        return {
          executedAction: {
            action: 'type',
            targetId: resolvedTargetId || snapshot.activeElementId,
            text: typedText
          },
          page,
          capturedCoverLetterText: isCoverLetterFieldKind(fieldKind) ? typedText : undefined
        };
      }
      if (!resolvedTargetId) {
        throw new Error('LLM type action could not resolve an editable target.');
      }
      await typeIntoTarget(page, resolvedTargetId, typedText, snapshot);
      return {
        executedAction: { action: 'type', targetId: resolvedTargetId, text: typedText },
        page,
        capturedCoverLetterText: isCoverLetterFieldKind(fieldKind) ? typedText : undefined
      };
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
      return {
        executedAction: { action: 'select', targetId: decision.targetId, option: resolvedOption },
        page
      };
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
      return {
        executedAction: { action: 'check', targetId: decision.targetId, checked: decision.checked },
        page
      };
    }
    case 'upload_resume': {
      let resolvedTargetId = resolveUploadTargetId(snapshot, decision);
      if (!resolvedTargetId) {
        throw new Error('LLM upload_resume action could not resolve an upload target from the current page snapshot.');
      }
      const selectedResumeOption = resolveResumeOptionForUpload(
        decision.resumeRef,
        activeResumeOption,
        availableResumeOptionsByRef
      );
      let locator;
      try {
        locator = await prepareTargetLocator(page, resolvedTargetId, { requireVisible: false });
      } catch {
        const refreshedSnapshot = await capturePageSnapshot(page);
        resolvedTargetId = resolveUploadTargetId(refreshedSnapshot, decision);
        if (!resolvedTargetId) {
          throw new Error('No uploadable resume input is currently available on the page.');
        }
        locator = await prepareTargetLocator(page, resolvedTargetId, { requireVisible: false });
      }
      await locator.setInputFiles(selectedResumeOption.filePath, { timeout: 10000 });
      await settlePage(page);
      return {
        executedAction: {
          action: 'upload_resume',
          targetId: resolvedTargetId,
          resumeRef: selectedResumeOption.resumeRef,
          resumeFileName: selectedResumeOption.resume.fileName
        },
        page,
        nextActiveResume: selectedResumeOption
      };
    }
    case 'press': {
      const resolved = await completeInteractivePageAction(page, async () => {
        if (decision.targetId) {
          await (await prepareTargetLocator(page, decision.targetId)).focus();
          await page.waitForTimeout(100);
        }
        await page.keyboard.press(decision.key || 'Tab');
        await page.waitForTimeout(250);
      });
      return {
        executedAction: { action: 'press', targetId: decision.targetId, key: decision.key || 'Tab' },
        page: resolved.page,
        pageChangeMessage: resolved.pageChangeMessage
      };
    }
    case 'scroll': {
      await page.mouse.wheel(0, decision.amount || 750);
      await page.waitForTimeout(250);
      return { executedAction: { action: 'scroll', amount: decision.amount || 750 }, page };
    }
    case 'scroll_into_view': {
      if (!decision.targetId) {
        throw new Error('LLM scroll_into_view action did not include a targetId.');
      }
      await (await prepareTargetLocator(page, decision.targetId)).scrollIntoViewIfNeeded({
        timeout: 10000
      });
      await page.waitForTimeout(200);
      return { executedAction: { action: 'scroll_into_view', targetId: decision.targetId }, page };
    }
    case 'wait': {
      const waitMs = Math.max(250, Math.min(10000, decision.amount || 1500));
      await page.waitForTimeout(waitMs);
      return { executedAction: { action: 'wait', amount: waitMs }, page };
    }
    case 'wait_for_text': {
      const textQuery = decision.textQuery || decision.text || '';
      await waitForVisibleText(
        page,
        textQuery,
        decision.amount || 10000
      );
      await page.waitForTimeout(150);
      return {
        executedAction: { action: 'wait_for_text', textQuery, amount: decision.amount || 10000 },
        page
      };
    }
    case 'go_back': {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await settlePage(page);
      return { executedAction: { action: 'go_back' }, page };
    }
    case 'reload': {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await settlePage(page);
      return { executedAction: { action: 'reload' }, page };
    }
    case 'done':
    case 'fail':
      return { executedAction: { action: decision.action }, page };
  }
};

export const applyToJob = async (
  job: Job,
  resume: Resume,
  applicationProfile?: ApplicationProfile
): Promise<JobApplicationResult> => {
  const runArtifactsDir = createRunArtifactsDir(job);
  const availableResumeOptionsResult = await buildAvailableResumeOptions(
    job,
    resume,
    applicationProfile
  );
  const availableResumeOptions = availableResumeOptionsResult.options;
  if (availableResumeOptions.length === 0) {
    throw new Error('No uploaded resume file is available for auto-apply.');
  }
  const availableResumeOptionsByRef = new Map(
    availableResumeOptions.map(option => [option.resumeRef.toLowerCase(), option] as const)
  );
  let activeResumeOption = availableResumeOptions[0];
  await closeSeekLoginSessionIfOpen();
  const session = await launchBrowserSession();
  const logs: string[] = [];
  const artifacts: ApplicationArtifact[] = [];
  let lastSnapshot: PageSnapshot | null = null;
  let lastCoverLetterText: string | undefined;

  try {
    let currentPage = session.page;
    logs.push(...availableResumeOptionsResult.selectionLogs);
    logs.push(
      `Available resumes: ${availableResumeOptions
        .map(option => {
          const optionLabel = `${option.resumeRef}=${option.resume.fileName}`;
          return `${optionLabel}${option.resumeRef === activeResumeOption.resumeRef ? ' (active)' : ''}`;
        })
        .join('; ')}`
    );
    logs.push(`Opening job page: ${job.url}`);
    await currentPage.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settlePage(currentPage);
    ensureAllowedAutomationUrl(currentPage.url());
    artifacts.push(await captureRunScreenshot(currentPage, runArtifactsDir, 0, 'initial-page'));

    for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
      lastSnapshot = await capturePageSnapshot(currentPage);
      ensureAllowedAutomationUrl(lastSnapshot.url);

      const completionMessage = detectCompletion(lastSnapshot);
      if (completionMessage) {
        logs.push(`Step ${step}: ${completionMessage}`);
        return {
          status: 'applied',
          message: completionMessage,
          logs,
          finalUrl: lastSnapshot.url,
          steps: step,
          artifacts,
          applicationSnapshot: buildApplicationSnapshotFromOption(job, activeResumeOption, {
            coverLetterText: lastCoverLetterText,
            coverLetterUsed: Boolean(lastCoverLetterText)
          })
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
            activeResumeOption,
            availableResumeOptions,
            applicationProfile,
            workingSnapshot,
            logs,
            stepExtraInstruction,
            attemptFeedback
          );

          if (shouldForceContinueAutomation(decision, workingSnapshot, applicationProfile)) {
            logs.push(
              `${attemptLabel}: continuing instead of review - ${decision.message || decision.reasoning.slice(0, 180)}`
            );
            stepExtraInstruction = FORCE_CONTINUE_INSTRUCTION;
            decision = await planNextAction(
              job,
              activeResumeOption,
              availableResumeOptions,
              applicationProfile,
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
              await captureRunScreenshot(currentPage, runArtifactsDir, step, `step-${step}-attempt-${attempt}-done`)
            );
            return {
              status: decision.finalStatus || 'review_required',
              message: decision.message || 'Application flow reached a stopping point.',
              logs,
              finalUrl: workingSnapshot.url,
              steps: step,
              artifacts,
              applicationSnapshot: buildApplicationSnapshotFromOption(job, activeResumeOption, {
                coverLetterText: lastCoverLetterText,
                coverLetterUsed: Boolean(lastCoverLetterText)
              })
            };
          }

          if (decision.action === 'fail') {
            artifacts.push(
              await captureRunScreenshot(currentPage, runArtifactsDir, step, `step-${step}-attempt-${attempt}-fail`)
            );
            return {
              status: 'failed',
              message: decision.message || 'Application agent could not continue.',
              logs,
              finalUrl: workingSnapshot.url,
              steps: step,
              artifacts,
              applicationSnapshot: buildApplicationSnapshotFromOption(job, activeResumeOption, {
                coverLetterText: lastCoverLetterText,
                coverLetterUsed: Boolean(lastCoverLetterText)
              })
            };
          }

          const execution = await executeDecision(
            currentPage,
            decision,
            activeResumeOption,
            availableResumeOptionsByRef,
            applicationProfile,
            workingSnapshot,
            job
          );
          if (execution.nextActiveResume) {
            const previousResumeRef = activeResumeOption.resumeRef;
            activeResumeOption = execution.nextActiveResume;
            logs.push(
              `${attemptLabel} resume - using ${activeResumeOption.resumeRef} (${activeResumeOption.resume.fileName})` +
                `${activeResumeOption.resumeRef !== previousResumeRef ? ' as the active resume.' : '.'}`
            );
          }
          if (execution.capturedCoverLetterText) {
            lastCoverLetterText = execution.capturedCoverLetterText;
          }
          currentPage = execution.page;
          session.page = currentPage;
          if (execution.pageChangeMessage) {
            logs.push(`${attemptLabel} navigation - ${execution.pageChangeMessage}`);
          }
          const postActionSnapshot = await capturePageSnapshot(currentPage);
          const verification = verifyActionOutcome(
            execution.executedAction,
            workingSnapshot,
            postActionSnapshot
          );
          logs.push(`${attemptLabel} check - ${verification.message}`);
          artifacts.push(
            await captureRunScreenshot(
              currentPage,
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
            `The previous attempt used action "${execution.executedAction.action}" and did not succeed. ${verification.message} Do not repeat the same ineffective action unless the latest snapshot clearly shows it is necessary.`,
            500
          );
          logs.push(
            `Step ${step} retry ${attempt + 1}/${MAX_STEP_RECOVERY_ATTEMPTS} - ${verification.message}`
          );
        } catch (error) {
          const blockedExternalWebsite = isExternalWebsiteBlockedError(error);
          const message = error instanceof Error ? error.message : 'Unknown step error';
          try {
            artifacts.push(
              await captureRunScreenshot(
                currentPage,
                runArtifactsDir,
                step,
                blockedExternalWebsite
                  ? `step-${step}-attempt-${attempt}-skipped-external`
                  : `step-${step}-attempt-${attempt}-error`
              )
            );
          } catch {
            // Ignore screenshot failures while recovering from the original step error.
          }

          if (blockedExternalWebsite) {
            logs.push(`${attemptLabel} skipped - ${message}`);
            throw error;
          }

          logs.push(`${attemptLabel} failed - ${message}`);

          try {
            workingSnapshot = await capturePageSnapshot(currentPage);
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
      artifacts,
      applicationSnapshot: buildApplicationSnapshotFromOption(job, activeResumeOption, {
        coverLetterText: lastCoverLetterText,
        coverLetterUsed: Boolean(lastCoverLetterText)
      })
    };
  } catch (error) {
    const blockedExternalWebsite = isExternalWebsiteBlockedError(error);
    const blockedUrl = blockedExternalWebsite ? error.blockedUrl : undefined;
    const message = error instanceof Error ? error.message : 'Unknown application error';
    try {
      artifacts.push(
        await captureRunScreenshot(
          session.page,
          runArtifactsDir,
          logs.length + 1,
          blockedExternalWebsite ? 'skipped-external-website' : 'failure-state'
        )
      );
    } catch {
      // Ignore screenshot failures while reporting the original apply error.
    }
    logs.push(`${blockedExternalWebsite ? 'Skipped' : 'Failed'}: ${message}`);
    return {
      status: blockedExternalWebsite ? 'skipped' : 'failed',
      message,
      logs,
      finalUrl: blockedUrl || lastSnapshot?.url || job.url,
      steps: logs.length,
      artifacts,
      applicationSnapshot: buildApplicationSnapshotFromOption(job, activeResumeOption, {
        coverLetterText: lastCoverLetterText,
        coverLetterUsed: Boolean(lastCoverLetterText)
      })
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
