export type WorkRightsStatus =
  | ''
  | 'australian_citizen_or_permanent_resident'
  | 'temporary_visa_with_work_rights'
  | 'require_employer_sponsorship'
  | 'other';

export type DriversLicenceStatus = '' | 'full' | 'provisional_or_learner' | 'none';
export type CarAccessStatus = '' | 'regular_access' | 'no_regular_access';

export interface ApplicationProfile {
  fullName: string;
  email: string;
  phone: string;
  currentLocation: string;
  linkedinUrl: string;
  portfolioUrl: string;
  githubUrl: string;
  noticePeriod: string;
  availability: string;
  professionalSummary: string;
  skillsDetails: string;
  previousJobsDetails: string;
  educationDetails: string;
  workRightsStatus: WorkRightsStatus;
  workRightsDetails: string;
  driversLicenceStatus: DriversLicenceStatus;
  carAccessStatus: CarAccessStatus;
  salaryExpectationAnnual: string;
  employerQuestionNotes: string;
}

export const DEFAULT_APPLICATION_PROFILE: ApplicationProfile = {
  fullName: '',
  email: '',
  phone: '',
  currentLocation: '',
  linkedinUrl: '',
  portfolioUrl: '',
  githubUrl: '',
  noticePeriod: '',
  availability: '',
  professionalSummary: '',
  skillsDetails: '',
  previousJobsDetails: '',
  educationDetails: '',
  workRightsStatus: '',
  workRightsDetails: '',
  driversLicenceStatus: '',
  carAccessStatus: '',
  salaryExpectationAnnual: '',
  employerQuestionNotes: ''
};

const WORK_RIGHTS_OPTIONS: WorkRightsStatus[] = [
  '',
  'australian_citizen_or_permanent_resident',
  'temporary_visa_with_work_rights',
  'require_employer_sponsorship',
  'other'
];

const DRIVERS_LICENCE_OPTIONS: DriversLicenceStatus[] = ['', 'full', 'provisional_or_learner', 'none'];
const CAR_ACCESS_OPTIONS: CarAccessStatus[] = ['', 'regular_access', 'no_regular_access'];

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value : '').trim();

export const normalizeApplicationProfile = (value: unknown): ApplicationProfile => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APPLICATION_PROFILE };
  }

  const candidate = value as Record<string, unknown>;
  const workRightsStatus = normalizeString(candidate.workRightsStatus) as WorkRightsStatus;
  const driversLicenceStatus = normalizeString(candidate.driversLicenceStatus) as DriversLicenceStatus;
  const carAccessStatus = normalizeString(candidate.carAccessStatus) as CarAccessStatus;

  return {
    fullName: normalizeString(candidate.fullName),
    email: normalizeString(candidate.email),
    phone: normalizeString(candidate.phone),
    currentLocation: normalizeString(candidate.currentLocation),
    linkedinUrl: normalizeString(candidate.linkedinUrl),
    portfolioUrl: normalizeString(candidate.portfolioUrl),
    githubUrl: normalizeString(candidate.githubUrl),
    noticePeriod: normalizeString(candidate.noticePeriod),
    availability: normalizeString(candidate.availability),
    professionalSummary: normalizeString(candidate.professionalSummary),
    skillsDetails: normalizeString(candidate.skillsDetails),
    previousJobsDetails: normalizeString(candidate.previousJobsDetails),
    educationDetails: normalizeString(candidate.educationDetails),
    workRightsStatus: WORK_RIGHTS_OPTIONS.includes(workRightsStatus)
      ? workRightsStatus
      : DEFAULT_APPLICATION_PROFILE.workRightsStatus,
    workRightsDetails: normalizeString(candidate.workRightsDetails),
    driversLicenceStatus: DRIVERS_LICENCE_OPTIONS.includes(driversLicenceStatus)
      ? driversLicenceStatus
      : DEFAULT_APPLICATION_PROFILE.driversLicenceStatus,
    carAccessStatus: CAR_ACCESS_OPTIONS.includes(carAccessStatus)
      ? carAccessStatus
      : DEFAULT_APPLICATION_PROFILE.carAccessStatus,
    salaryExpectationAnnual: normalizeString(candidate.salaryExpectationAnnual),
    employerQuestionNotes: normalizeString(candidate.employerQuestionNotes)
  };
};
