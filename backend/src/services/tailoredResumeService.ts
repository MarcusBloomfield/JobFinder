import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { ApplicationProfile } from '../models/ApplicationProfile';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /\b(?:\+?\d[\d()\-\s]{7,}\d)\b/;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/gi;
const MAX_PROFILE_SUMMARY_CHARS = 520;
const MAX_LINE_CHARS = 220;
const MAX_FILENAME_CHARS = 150;
const MAX_SOURCE_RESUME_LINES = 140;
const MAX_ADDITIONAL_SOURCE_LINES = 90;
const PLAYWRIGHT_ARTIFACTS_DIR = path.resolve(__dirname, '../../.playwright');
export const TAILORED_RESUMES_DIR = path.join(PLAYWRIGHT_ARTIFACTS_DIR, 'tailored-resumes');

const STOP_WORDS = new Set([
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

export interface TailoredResumeResult {
  resume: Resume;
  filePath: string;
  storedFileName: string;
  sourceResumeId: string;
  sourceResumeFileName: string;
  matchKeywords: string[];
  tailoringNotes: string[];
  relevanceScore: number;
}

export interface TailoredResumeInfo {
  id: string;
  fileName: string;
  fileType: 'docx';
  content: string;
  url: string;
  storedFileName: string;
  sourceResumeId: string;
  sourceResumeFileName: string;
  matchKeywords: string[];
  tailoringNotes: string[];
  createdAt: string;
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeOptionalText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = normalizeWhitespace(value);
  return normalized ? normalized : undefined;
};

const compactText = (value: string, maxLength = MAX_LINE_CHARS): string =>
  normalizeWhitespace(value).slice(0, maxLength).trim();

const getResumeBaseName = (resume: Resume): string =>
  path.basename(resume.fileName, path.extname(resume.fileName)) || 'resume';

const splitDetailItems = (value?: string, options?: { splitCommas?: boolean }): string[] => {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  const separatorPattern = options?.splitCommas ? /[\r\n;,|]+/ : /[\r\n;|]+/;
  return value
    .split(separatorPattern)
    .map(item => item.replace(/^\s*[-*]+\s*/, ''))
    .map(item => compactText(item))
    .filter(item => item.length > 1);
};

const normalizeStringArray = (value?: string[]): string[] =>
  Array.isArray(value)
    ? value
        .map(item => compactText(item))
        .filter(item => item.length > 1)
    : [];

const dedupeItems = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  items.forEach(item => {
    const normalized = item.toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    result.push(item);
  });

  return result;
};

const getSourceResumeLines = (resume: Resume): string[] =>
  dedupeItems(
    resume.content
      .split(/\r?\n/)
      .map(line => compactText(line))
      .filter(line => line.length > 0)
  ).slice(0, MAX_SOURCE_RESUME_LINES);

const removeKnownItems = (items: string[], itemsToRemove: string[]): string[] => {
  const normalizedItemsToRemove = new Set(itemsToRemove.map(item => item.toLowerCase()));
  return items.filter(item => !normalizedItemsToRemove.has(item.toLowerCase()));
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token));

const extractJobKeywords = (job: Job): string[] => {
  const titleTokens = tokenize(job.title);
  const tokenCounts = new Map<string, number>();

  tokenize(`${job.title} ${job.company} ${job.description}`).forEach(token => {
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

const rankItems = (items: string[], keywords: string[], limit: number): string[] =>
  dedupeItems(items)
    .map((item, index) => ({
      item,
      index,
      score: scoreTextAgainstKeywords(item, keywords)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(entry => entry.item);

const getCandidateName = (resume: Resume, applicationProfile?: ApplicationProfile): string => {
  const profileName = normalizeOptionalText(applicationProfile?.fullName);
  if (profileName) {
    return profileName;
  }

  const firstResumeLine = resume.content
    .split(/\r?\n/)
    .map(line => compactText(line, 120))
    .find(line => line && !line.includes('@') && line.split(/\s+/).length >= 2 && line.split(/\s+/).length <= 5);

  return firstResumeLine || getResumeBaseName(resume);
};

const getContactLines = (resume: Resume, applicationProfile?: ApplicationProfile): string[] => {
  const email = normalizeOptionalText(applicationProfile?.email) || resume.content.match(EMAIL_PATTERN)?.[0];
  const phone = normalizeOptionalText(applicationProfile?.phone) || resume.content.match(PHONE_PATTERN)?.[0];
  const urls = resume.content.match(URL_PATTERN) || [];
  const linkedin = normalizeOptionalText(applicationProfile?.linkedinUrl) || urls.find(url => /linkedin\.com/i.test(url));
  const github = normalizeOptionalText(applicationProfile?.githubUrl) || urls.find(url => /github\.com/i.test(url));
  const website =
    normalizeOptionalText(applicationProfile?.portfolioUrl) ||
    urls.find(url => !/linkedin\.com|github\.com/i.test(url));
  const location = normalizeOptionalText(applicationProfile?.currentLocation);

  return [
    email,
    phone,
    location,
    linkedin,
    github,
    website
  ].filter((item): item is string => Boolean(item));
};

const buildWorkRightsLine = (applicationProfile?: ApplicationProfile): string | undefined => {
  if (!applicationProfile) {
    return undefined;
  }

  const details = normalizeOptionalText(applicationProfile.workRightsDetails);
  switch (applicationProfile.workRightsStatus) {
    case 'australian_citizen_or_permanent_resident':
      return details
        ? `Work rights: Australian citizen or permanent resident. ${details}`
        : 'Work rights: Australian citizen or permanent resident.';
    case 'temporary_visa_with_work_rights':
      return details
        ? `Work rights: temporary visa with current work rights. ${details}`
        : 'Work rights: temporary visa with current work rights.';
    case 'require_employer_sponsorship':
      return details
        ? `Work rights: requires employer sponsorship. ${details}`
        : 'Work rights: requires employer sponsorship.';
    case 'other':
      return details ? `Work rights: ${details}` : undefined;
    default:
      return details ? `Work rights: ${details}` : undefined;
  }
};

const buildProfileDetailLines = (applicationProfile?: ApplicationProfile): string[] => {
  if (!applicationProfile) {
    return [];
  }

  const driverLicence =
    applicationProfile.driversLicenceStatus === 'full'
      ? 'Driver licence: full.'
      : applicationProfile.driversLicenceStatus === 'provisional_or_learner'
      ? 'Driver licence: provisional or learner.'
      : applicationProfile.driversLicenceStatus === 'none'
      ? 'Driver licence: none.'
      : undefined;
  const carAccess =
    applicationProfile.carAccessStatus === 'regular_access'
      ? 'Regular access to a car.'
      : applicationProfile.carAccessStatus === 'no_regular_access'
      ? 'No regular access to a car.'
      : undefined;

  return [
    normalizeOptionalText(applicationProfile.availability)
      ? `Availability: ${applicationProfile.availability.trim()}`
      : undefined,
    normalizeOptionalText(applicationProfile.noticePeriod)
      ? `Notice period: ${applicationProfile.noticePeriod.trim()}`
      : undefined,
    buildWorkRightsLine(applicationProfile),
    driverLicence,
    carAccess
  ].filter((item): item is string => Boolean(item));
};

const getFallbackResumeLines = (resume: Resume): string[] =>
  resume.content
    .split(/\r?\n/)
    .map(line => compactText(line))
    .filter(line => line.length >= 20 && !EMAIL_PATTERN.test(line) && !PHONE_PATTERN.test(line))
    .slice(0, 80);

const buildSummary = (
  job: Job,
  relevantSkills: string[],
  relevantExperience: string[],
  applicationProfile?: ApplicationProfile
): string | undefined => {
  const profileSummary = normalizeOptionalText(applicationProfile?.professionalSummary);
  if (profileSummary) {
    return compactText(profileSummary, MAX_PROFILE_SUMMARY_CHARS);
  }

  if (relevantExperience.length > 0) {
    return compactText(relevantExperience[0], MAX_PROFILE_SUMMARY_CHARS);
  }

  if (relevantSkills.length > 0) {
    return compactText(relevantSkills.slice(0, 8).join(', '), MAX_PROFILE_SUMMARY_CHARS);
  }

  return undefined;
};

const sanitizeFilePart = (value: string): string => {
  const normalized = normalizeWhitespace(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/[^a-zA-Z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'Resume';
};

const fitFileName = (fileName: string): string => {
  if (fileName.length <= MAX_FILENAME_CHARS) {
    return fileName;
  }

  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  return `${base.slice(0, MAX_FILENAME_CHARS - extension.length)}${extension}`;
};

const buildTailoredResumeFileName = (
  job: Job,
  resume: Resume,
  applicationProfile?: ApplicationProfile
): string => {
  const candidateName = sanitizeFilePart(getCandidateName(resume, applicationProfile));
  const company = sanitizeFilePart(job.company || 'Company');
  const title = sanitizeFilePart(job.title || 'Role');
  return fitFileName(`${candidateName}_${company}_${title}_Tailored_Resume.docx`);
};

const getUniqueFilePath = (directory: string, fileName: string): string => {
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  let candidate = path.join(directory, fileName);
  let suffix = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, fitFileName(`${base}_${suffix}${extension}`));
    suffix += 1;
  }

  return candidate;
};

export const getTailoredResumeBatchDirectory = (): string => {
  const directory = path.join(
    TAILORED_RESUMES_DIR,
    new Date().toISOString().replace(/[:.]/g, '-')
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

export const getTailoredResumeStoredFileName = (filePath: string): string => {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedRoot = path.resolve(TAILORED_RESUMES_DIR);

  if (!resolvedFilePath.startsWith(resolvedRoot)) {
    throw new Error('Tailored resume file is outside the tailored resume directory.');
  }

  return path.relative(resolvedRoot, resolvedFilePath).replace(/\\/g, '/');
};

export const resolveTailoredResumeFilePath = (storedFileName: string): string => {
  const safeStoredFileName = storedFileName.replace(/\\/g, '/');
  if (!safeStoredFileName || safeStoredFileName.includes('..') || path.isAbsolute(safeStoredFileName)) {
    throw new Error('Invalid tailored resume token.');
  }

  const resolved = path.resolve(TAILORED_RESUMES_DIR, safeStoredFileName);
  if (!resolved.startsWith(path.resolve(TAILORED_RESUMES_DIR))) {
    throw new Error('Resolved tailored resume path is outside the tailored resume directory.');
  }

  if (!fs.existsSync(resolved)) {
    throw new Error('Tailored resume file could not be found on the server.');
  }

  return resolved;
};

export const buildTailoredResumeUrl = (filePath: string, artifactsBaseUrl: string): string => {
  const relativePath = path.relative(PLAYWRIGHT_ARTIFACTS_DIR, filePath);
  return `${artifactsBaseUrl}/${relativePath.replace(/\\/g, '/')}`;
};

const heading = (text: string): Paragraph =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true })]
  });

const paragraph = (text: string): Paragraph =>
  new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text })]
  });

const bullet = (text: string): Paragraph =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text })]
  });

const addSection = (children: Paragraph[], title: string, items: string[]): void => {
  if (items.length === 0) {
    return;
  }

  children.push(heading(title));
  items.forEach(item => children.push(bullet(item)));
};

const buildPlainTextContent = (parts: {
  name: string;
  contactLines: string[];
  targetLine: string;
  summary?: string;
  skills: string[];
  experience: string[];
  education: string[];
  additionalSourceLines: string[];
  profileDetails: string[];
}): string =>
  [
    parts.name,
    parts.contactLines.join(' | '),
    parts.targetLine,
    '',
    'Profile',
    parts.summary || '',
    '',
    'Relevant Skills',
    parts.skills.join(', '),
    '',
    'Relevant Experience',
    parts.experience.join('\n'),
    '',
    'Education and Qualifications',
    parts.education.join('\n'),
    '',
    'Additional Experience and Details',
    parts.additionalSourceLines.join('\n'),
    '',
    'Additional Application Details',
    parts.profileDetails.join('\n')
  ]
    .filter(part => part !== undefined && part !== null)
    .join('\n')
    .trim();

const createDocument = (parts: {
  name: string;
  contactLines: string[];
  targetLine: string;
  summary?: string;
  skills: string[];
  experience: string[];
  education: string[];
  additionalSourceLines: string[];
  profileDetails: string[];
}): Document => {
  const children: Paragraph[] = [
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: parts.name, bold: true, size: 32 })]
    })
  ];

  if (parts.contactLines.length > 0) {
    children.push(paragraph(parts.contactLines.join(' | ')));
  }

  children.push(paragraph(parts.targetLine));
  if (parts.summary) {
    children.push(heading('Profile'));
    children.push(paragraph(parts.summary));
  }
  addSection(children, 'Relevant Skills', parts.skills);
  addSection(children, 'Relevant Experience', parts.experience);
  addSection(children, 'Education and Qualifications', parts.education);
  addSection(children, 'Additional Experience and Details', parts.additionalSourceLines);
  addSection(children, 'Additional Application Details', parts.profileDetails);

  return new Document({
    creator: 'JobFinder',
    title: `${parts.name} tailored resume`,
    sections: [
      {
        properties: {},
        children
      }
    ]
  });
};

export const scoreResumeForJob = (
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

export const createTailoredResumeForJob = async (
  job: Job,
  sourceResume: Resume,
  applicationProfile: ApplicationProfile | undefined,
  outputDirectory: string
): Promise<TailoredResumeResult> => {
  fs.mkdirSync(outputDirectory, { recursive: true });

  const jobKeywords = extractJobKeywords(job);
  const rawSkills = [
    ...splitDetailItems(applicationProfile?.skillsDetails, { splitCommas: true }),
    ...normalizeStringArray(sourceResume.skills)
  ];
  const fallbackLines = getFallbackResumeLines(sourceResume);
  const rawExperience = [
    ...splitDetailItems(applicationProfile?.previousJobsDetails),
    ...normalizeStringArray(sourceResume.experience),
    ...fallbackLines
  ];
  const rawEducation = [
    ...splitDetailItems(applicationProfile?.educationDetails),
    ...normalizeStringArray(sourceResume.education)
  ];
  const sourceResumeLines = getSourceResumeLines(sourceResume);

  const relevantSkills = rankItems(rawSkills, jobKeywords, 14);
  const relevantExperience = rankItems(rawExperience, jobKeywords, 12);
  const relevantEducation = rankItems(rawEducation, jobKeywords, 6);
  const profileDetails = buildProfileDetailLines(applicationProfile);
  const name = getCandidateName(sourceResume, applicationProfile);
  const contactLines = getContactLines(sourceResume, applicationProfile);
  const targetLine = compactText(`Target role: ${job.title} at ${job.company}`, 180);
  const summary = buildSummary(job, relevantSkills, relevantExperience, applicationProfile);
  const additionalSourceLines = removeKnownItems(sourceResumeLines, [
    name,
    ...contactLines,
    ...(summary ? [summary] : []),
    ...relevantExperience,
    ...relevantEducation
  ]).slice(0, MAX_ADDITIONAL_SOURCE_LINES);
  const fileName = buildTailoredResumeFileName(job, sourceResume, applicationProfile);
  const filePath = getUniqueFilePath(outputDirectory, fileName);
  const generatedFileName = path.basename(filePath);
  const plainTextContent = buildPlainTextContent({
    name,
    contactLines,
    targetLine,
    summary,
    skills: relevantSkills,
    experience: relevantExperience,
    education: relevantEducation,
    additionalSourceLines,
    profileDetails
  });

  const document = createDocument({
    name,
    contactLines,
    targetLine,
    summary,
    skills: relevantSkills,
    experience: relevantExperience,
    education: relevantEducation,
    additionalSourceLines,
    profileDetails
  });
  const buffer = await Packer.toBuffer(document);
  fs.writeFileSync(filePath, buffer);

  const matchedKeywords = jobKeywords
    .filter(keyword => plainTextContent.toLowerCase().includes(keyword))
    .slice(0, 12);
  const tailoringNotes = [
    `Altered "${sourceResume.fileName}" for ${job.company || 'the employer'} and ${job.title || 'the role'} instead of rebuilding a resume from scratch.`,
    `Promoted existing resume/profile facts matching: ${matchedKeywords.join(', ') || 'available role details'}.`,
    'Kept source resume details in the document and only added explicit saved profile facts where available.',
    'No qualifications, employers, dates, licences, or work rights were added unless present in the uploaded resume or saved profile.'
  ];

  return {
    resume: {
      id: `tailored-${randomUUID()}`,
      fileName: generatedFileName,
      fileType: 'docx',
      content: plainTextContent,
      uploadedAt: new Date().toISOString(),
      skills: relevantSkills,
      experience: relevantExperience,
      education: relevantEducation
    },
    filePath,
    storedFileName: filePath.startsWith(path.resolve(TAILORED_RESUMES_DIR))
      ? getTailoredResumeStoredFileName(filePath)
      : '',
    sourceResumeId: sourceResume.id,
    sourceResumeFileName: sourceResume.fileName,
    matchKeywords: matchedKeywords,
    tailoringNotes,
    relevanceScore: scoreResumeForJob(sourceResume, job, applicationProfile)
  };
};
