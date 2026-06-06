import OpenAI from 'openai';
import {
  ApplicationProfile,
  CarAccessStatus,
  DriversLicenceStatus,
  WorkRightsStatus
} from '../models/ApplicationProfile';
import { Resume } from '../models/Resume';

const PROFILE_FILL_MODEL = process.env.PROFILE_FILL_MODEL || 'gpt-5.4-mini';
const MAX_RESUMES = Number(process.env.PROFILE_FILL_MAX_RESUMES || 8);
const MAX_RESUME_CHARS = Number(process.env.PROFILE_FILL_MAX_RESUME_CHARS || 7000);

const WORK_RIGHTS_STATUSES: WorkRightsStatus[] = [
  '',
  'australian_citizen_or_permanent_resident',
  'temporary_visa_with_work_rights',
  'require_employer_sponsorship',
  'other'
];
const DRIVERS_LICENCE_STATUSES: DriversLicenceStatus[] = ['', 'full', 'provisional_or_learner', 'none'];
const CAR_ACCESS_STATUSES: CarAccessStatus[] = ['', 'regular_access', 'no_regular_access'];

let openaiClient: OpenAI | null = null;

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

const compactText = (value: string, maxLength: number): string =>
  value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeProfile = (
  value: unknown,
  fallback: ApplicationProfile
): ApplicationProfile => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const workRightsStatus = normalizeString(candidate.workRightsStatus) as WorkRightsStatus;
  const driversLicenceStatus = normalizeString(candidate.driversLicenceStatus) as DriversLicenceStatus;
  const carAccessStatus = normalizeString(candidate.carAccessStatus) as CarAccessStatus;

  return {
    fullName: normalizeString(candidate.fullName) || fallback.fullName,
    email: normalizeString(candidate.email) || fallback.email,
    phone: normalizeString(candidate.phone) || fallback.phone,
    currentLocation: normalizeString(candidate.currentLocation) || fallback.currentLocation,
    linkedinUrl: normalizeString(candidate.linkedinUrl) || fallback.linkedinUrl,
    portfolioUrl: normalizeString(candidate.portfolioUrl) || fallback.portfolioUrl,
    githubUrl: normalizeString(candidate.githubUrl) || fallback.githubUrl,
    noticePeriod: normalizeString(candidate.noticePeriod) || fallback.noticePeriod,
    availability: normalizeString(candidate.availability) || fallback.availability,
    professionalSummary: normalizeString(candidate.professionalSummary) || fallback.professionalSummary,
    skillsDetails: normalizeString(candidate.skillsDetails) || fallback.skillsDetails,
    previousJobsDetails: normalizeString(candidate.previousJobsDetails) || fallback.previousJobsDetails,
    educationDetails: normalizeString(candidate.educationDetails) || fallback.educationDetails,
    workRightsStatus: WORK_RIGHTS_STATUSES.includes(workRightsStatus)
      ? workRightsStatus
      : fallback.workRightsStatus,
    workRightsDetails: normalizeString(candidate.workRightsDetails) || fallback.workRightsDetails,
    driversLicenceStatus: DRIVERS_LICENCE_STATUSES.includes(driversLicenceStatus)
      ? driversLicenceStatus
      : fallback.driversLicenceStatus,
    carAccessStatus: CAR_ACCESS_STATUSES.includes(carAccessStatus)
      ? carAccessStatus
      : fallback.carAccessStatus,
    salaryExpectationAnnual:
      normalizeString(candidate.salaryExpectationAnnual) || fallback.salaryExpectationAnnual,
    employerQuestionNotes:
      normalizeString(candidate.employerQuestionNotes) || fallback.employerQuestionNotes
  };
};

const buildResumePayload = (resumes: Resume[]) =>
  resumes
    .filter(resume => resume.content.trim())
    .slice(0, MAX_RESUMES)
    .map(resume => ({
      fileName: resume.fileName,
      fileType: resume.fileType,
      uploadedAt: resume.uploadedAt,
      extractedSkills: resume.skills || [],
      extractedExperience: resume.experience || [],
      extractedEducation: resume.education || [],
      content: compactText(resume.content, MAX_RESUME_CHARS)
    }));

export interface ProfileFillResult {
  profile: ApplicationProfile;
  updatedFields: string[];
  sourceResumeCount: number;
}

export const fillApplicationProfileFromResumes = async (
  resumes: Resume[],
  currentProfile: ApplicationProfile
): Promise<ProfileFillResult> => {
  const resumePayload = buildResumePayload(resumes);
  if (resumePayload.length === 0) {
    throw new Error('At least one parsed resume with text content is required.');
  }

  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: PROFILE_FILL_MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          'You fill a job application profile from uploaded resume text. Return only JSON with a "profile" object. ' +
          'Use only facts explicitly present in the resumes or already present in currentProfile. Do not invent work rights, licences, car access, salary, availability, notice period, locations, links, employers, dates, qualifications, or skills. ' +
          'Keep existing non-empty currentProfile values unless the resume provides a direct explicit replacement. Use empty strings for unknown fields. ' +
          'For workRightsStatus use only "", "australian_citizen_or_permanent_resident", "temporary_visa_with_work_rights", "require_employer_sponsorship", or "other". ' +
          'For driversLicenceStatus use only "", "full", "provisional_or_learner", or "none". For carAccessStatus use only "", "regular_access", or "no_regular_access".'
      },
      {
        role: 'user',
        content: JSON.stringify({
          currentProfile,
          resumes: resumePayload,
          profileFields: Object.keys(currentProfile)
        })
      }
    ]
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error('AI profile fill returned an empty response.');
  }

  const parsed = JSON.parse(content) as { profile?: unknown };
  const profile = normalizeProfile(parsed.profile, currentProfile);
  const updatedFields = Object.keys(profile).filter(key => {
    const field = key as keyof ApplicationProfile;
    return currentProfile[field] !== profile[field];
  });

  return {
    profile,
    updatedFields,
    sourceResumeCount: resumePayload.length
  };
};
