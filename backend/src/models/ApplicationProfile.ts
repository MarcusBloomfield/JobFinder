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
