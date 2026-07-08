export const JOB_APPLICATION_METHODS = [
  '',
  'seek',
  'company_website',
  'email',
  'recruiter',
  'referral',
  'other'
] as const;

export type JobApplicationMethod = typeof JOB_APPLICATION_METHODS[number];

export const JOB_APPLICATION_METHOD_LABELS: Record<Exclude<JobApplicationMethod, ''>, string> = {
  seek: 'Seek',
  company_website: 'Company website',
  email: 'Email',
  recruiter: 'Recruiter',
  referral: 'Referral',
  other: 'Other'
};

export interface JobDetails {
  employerName: string;
  employerContactName: string;
  employerContactEmail: string;
  employerContactNumber: string;
  jobTitle: string;
  jobLocation: string;
  suburbOrPostcode: string;
  applicationMethod: JobApplicationMethod;
  applicationSubmittedDate: string;
  interviewedForJob: boolean;
  employedForJob: boolean;
}

export const DEFAULT_JOB_DETAILS: JobDetails = {
  employerName: '',
  employerContactName: '',
  employerContactEmail: '',
  employerContactNumber: '',
  jobTitle: '',
  jobLocation: '',
  suburbOrPostcode: '',
  applicationMethod: '',
  applicationSubmittedDate: '',
  interviewedForJob: false,
  employedForJob: false
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeDate = (value: unknown): string => {
  const normalized = normalizeString(value);
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

const normalizeBoolean = (value: unknown): boolean => value === true;

export const normalizeJobDetails = (candidate: Partial<JobDetails> | null | undefined): JobDetails => {
  const applicationMethod = candidate?.applicationMethod;

  return {
    employerName: normalizeString(candidate?.employerName),
    employerContactName: normalizeString(candidate?.employerContactName),
    employerContactEmail: normalizeString(candidate?.employerContactEmail),
    employerContactNumber: normalizeString(candidate?.employerContactNumber),
    jobTitle: normalizeString(candidate?.jobTitle),
    jobLocation: normalizeString(candidate?.jobLocation),
    suburbOrPostcode: normalizeString(candidate?.suburbOrPostcode),
    applicationMethod: JOB_APPLICATION_METHODS.includes(applicationMethod as JobApplicationMethod)
      ? (applicationMethod as JobApplicationMethod)
      : '',
    applicationSubmittedDate: normalizeDate(candidate?.applicationSubmittedDate),
    interviewedForJob: normalizeBoolean(candidate?.interviewedForJob),
    employedForJob: normalizeBoolean(candidate?.employedForJob)
  };
};
