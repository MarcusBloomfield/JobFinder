export type WorkRightsStatus =
  | ''
  | 'australian_citizen_or_permanent_resident'
  | 'temporary_visa_with_work_rights'
  | 'require_employer_sponsorship'
  | 'other';

export type DriversLicenceStatus = '' | 'full' | 'provisional_or_learner' | 'none';

export interface ApplicationProfile {
  workRightsStatus: WorkRightsStatus;
  workRightsDetails: string;
  driversLicenceStatus: DriversLicenceStatus;
  salaryExpectationAnnual: string;
  employerQuestionNotes: string;
}

export const DEFAULT_APPLICATION_PROFILE: ApplicationProfile = {
  workRightsStatus: '',
  workRightsDetails: '',
  driversLicenceStatus: '',
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

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value : '').trim();

export const normalizeApplicationProfile = (value: unknown): ApplicationProfile => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APPLICATION_PROFILE };
  }

  const candidate = value as Record<string, unknown>;
  const workRightsStatus = normalizeString(candidate.workRightsStatus) as WorkRightsStatus;
  const driversLicenceStatus = normalizeString(candidate.driversLicenceStatus) as DriversLicenceStatus;

  return {
    workRightsStatus: WORK_RIGHTS_OPTIONS.includes(workRightsStatus)
      ? workRightsStatus
      : DEFAULT_APPLICATION_PROFILE.workRightsStatus,
    workRightsDetails: normalizeString(candidate.workRightsDetails),
    driversLicenceStatus: DRIVERS_LICENCE_OPTIONS.includes(driversLicenceStatus)
      ? driversLicenceStatus
      : DEFAULT_APPLICATION_PROFILE.driversLicenceStatus,
    salaryExpectationAnnual: normalizeString(candidate.salaryExpectationAnnual),
    employerQuestionNotes: normalizeString(candidate.employerQuestionNotes)
  };
};
