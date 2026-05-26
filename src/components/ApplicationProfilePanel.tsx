import React from 'react';
import { ApplicationProfile } from '../models/ApplicationProfile';

interface ApplicationProfilePanelProps {
  profile: ApplicationProfile;
  onChange: (updates: Partial<ApplicationProfile>) => void;
}

const ApplicationProfilePanel: React.FC<ApplicationProfilePanelProps> = ({ profile, onChange }) => {
  return (
    <section className="application-profile-section">
      <div className="application-profile-header">
        <div>
          <h2>Common Application Answers</h2>
          <p className="application-profile-description">
            Saved locally in this browser and used by auto-apply for recurring employer questions.
          </p>
        </div>
        <span className="application-profile-badge">Auto-saved</span>
      </div>

      <div className="application-profile-grid">
        <label className="application-profile-field">
          <span>Work rights in Australia</span>
          <select
            value={profile.workRightsStatus}
            onChange={(event) => onChange({ workRightsStatus: event.target.value as ApplicationProfile['workRightsStatus'] })}
          >
            <option value="">Select an answer</option>
            <option value="australian_citizen_or_permanent_resident">
              Australian citizen or permanent resident
            </option>
            <option value="temporary_visa_with_work_rights">
              Temporary visa with current work rights
            </option>
            <option value="require_employer_sponsorship">Require employer sponsorship</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="application-profile-field">
          <span>Driver&apos;s licence status</span>
          <select
            value={profile.driversLicenceStatus}
            onChange={(event) =>
              onChange({ driversLicenceStatus: event.target.value as ApplicationProfile['driversLicenceStatus'] })
            }
          >
            <option value="">Select an answer</option>
            <option value="full">Full driver&apos;s licence</option>
            <option value="provisional_or_learner">Provisional or learner licence</option>
            <option value="none">No driver&apos;s licence</option>
          </select>
        </label>

        <label className="application-profile-field">
          <span>Expected annual base salary</span>
          <input
            type="text"
            placeholder="$85,000 or Negotiable"
            value={profile.salaryExpectationAnnual}
            onChange={(event) => onChange({ salaryExpectationAnnual: event.target.value })}
          />
        </label>

        <label className="application-profile-field application-profile-field-wide">
          <span>Work rights details</span>
          <input
            type="text"
            placeholder="Optional details, visa type, notice period, etc."
            value={profile.workRightsDetails}
            onChange={(event) => onChange({ workRightsDetails: event.target.value })}
          />
        </label>

        <label className="application-profile-field application-profile-field-wide">
          <span>Additional employer question notes</span>
          <textarea
            rows={4}
            placeholder="Anything you answer often, for example police checks, shift availability, notice period, or travel readiness."
            value={profile.employerQuestionNotes}
            onChange={(event) => onChange({ employerQuestionNotes: event.target.value })}
          />
        </label>
      </div>
    </section>
  );
};

export default ApplicationProfilePanel;
