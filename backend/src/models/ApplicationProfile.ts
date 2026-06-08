import { CoverLetterExample } from './CoverLetterExample';

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
  coverLetterExamples?: CoverLetterExample[];
}
