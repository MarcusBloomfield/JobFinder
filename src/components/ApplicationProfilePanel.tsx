import React from 'react';
import { ApplicationProfile } from '../models/ApplicationProfile';
import { TrackedJobApplication } from '../models/ApplicationTracking';

interface ApplicationProfilePanelProps {
  profile: ApplicationProfile;
  applicationHistory: TrackedJobApplication[];
  onChange: (updates: Partial<ApplicationProfile>) => void;
}

const getAppliedResumeLabel = (application: TrackedJobApplication): string =>
  application.resumeIsTailored
    ? `${application.resumeFileName} (Generated)`
    : `${application.resumeFileName} (Original)`;

const ApplicationProfilePanel: React.FC<ApplicationProfilePanelProps> = ({
  profile,
  applicationHistory,
  onChange
}) => {
  return (
    <>
      <section className="application-profile-section">
        <div className="application-profile-header">
          <div>
            <h2>Application Profile</h2>
            <p className="application-profile-description">
              Saved locally in this browser and used by auto-apply for contact details, recurring employer
              questions, profile-style answers, and manual background details you do not want taken
              from a resume.
            </p>
          </div>
          <span className="application-profile-badge">Auto-saved</span>
        </div>

        <div className="application-profile-grid">
          <div className="application-profile-subheading">Contact details</div>

        <label className="application-profile-field">
          <span>Full name</span>
          <input
            type="text"
            placeholder="Jane Citizen"
            value={profile.fullName}
            onChange={(event) => onChange({ fullName: event.target.value })}
          />
        </label>

        <label className="application-profile-field">
          <span>Email</span>
          <input
            type="email"
            placeholder="jane@example.com"
            value={profile.email}
            onChange={(event) => onChange({ email: event.target.value })}
          />
        </label>

        <label className="application-profile-field">
          <span>Phone</span>
          <input
            type="tel"
            placeholder="+61 4xx xxx xxx"
            value={profile.phone}
            onChange={(event) => onChange({ phone: event.target.value })}
          />
        </label>

        <label className="application-profile-field">
          <span>Current location</span>
          <input
            type="text"
            placeholder="Perth, WA 6000"
            value={profile.currentLocation}
            onChange={(event) => onChange({ currentLocation: event.target.value })}
          />
        </label>

        <div className="application-profile-subheading">Links and availability</div>

        <label className="application-profile-field">
          <span>LinkedIn URL</span>
          <input
            type="url"
            placeholder="https://www.linkedin.com/in/your-profile"
            value={profile.linkedinUrl}
            onChange={(event) => onChange({ linkedinUrl: event.target.value })}
          />
        </label>

        <label className="application-profile-field">
          <span>Portfolio or website URL</span>
          <input
            type="url"
            placeholder="https://your-site.com"
            value={profile.portfolioUrl}
            onChange={(event) => onChange({ portfolioUrl: event.target.value })}
          />
        </label>

        <label className="application-profile-field">
          <span>GitHub URL</span>
          <input
            type="url"
            placeholder="https://github.com/your-name"
            value={profile.githubUrl}
            onChange={(event) => onChange({ githubUrl: event.target.value })}
          />
        </label>

        <label className="application-profile-field">
          <span>Notice period</span>
          <input
            type="text"
            placeholder="Immediate or 2 weeks"
            value={profile.noticePeriod}
            onChange={(event) => onChange({ noticePeriod: event.target.value })}
          />
        </label>

        <label className="application-profile-field">
          <span>Availability</span>
          <input
            type="text"
            placeholder="Full-time weekdays, shifts, weekends, etc."
            value={profile.availability}
            onChange={(event) => onChange({ availability: event.target.value })}
          />
        </label>

        <div className="application-profile-subheading">Recurring employer answers</div>

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
          <span>Regular access to a car</span>
          <select
            value={profile.carAccessStatus}
            onChange={(event) =>
              onChange({ carAccessStatus: event.target.value as ApplicationProfile['carAccessStatus'] })
            }
          >
            <option value="">Select an answer</option>
            <option value="regular_access">Yes, regular access to a car</option>
            <option value="no_regular_access">No regular access to a car</option>
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

        <div className="application-profile-subheading">Manual background details</div>

        <label className="application-profile-field application-profile-field-wide">
          <span>About you / professional summary</span>
          <textarea
            rows={5}
            placeholder="Short About Me summary you want reused in profile and employer questions."
            value={profile.professionalSummary}
            onChange={(event) => onChange({ professionalSummary: event.target.value })}
          />
        </label>

        <label className="application-profile-field application-profile-field-wide">
          <span>Skills details</span>
          <textarea
            rows={5}
            placeholder="List the skills, tools, technologies, strengths, licences, or domain knowledge you want reused."
            value={profile.skillsDetails}
            onChange={(event) => onChange({ skillsDetails: event.target.value })}
          />
        </label>

        <label className="application-profile-field application-profile-field-wide">
          <span>Previous jobs / experience details</span>
          <textarea
            rows={7}
            placeholder="Add previous roles, employers, responsibilities, achievements, projects, and relevant experience in your own words."
            value={profile.previousJobsDetails}
            onChange={(event) => onChange({ previousJobsDetails: event.target.value })}
          />
        </label>

        <label className="application-profile-field application-profile-field-wide">
          <span>Education / qualification details</span>
          <textarea
            rows={5}
            placeholder="Add degrees, certificates, training, courses, or other education details you want reused."
            value={profile.educationDetails}
            onChange={(event) => onChange({ educationDetails: event.target.value })}
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

      <section className="application-profile-section">
        <div className="application-profile-header">
          <div>
            <h2>Application Resume History</h2>
            <p className="application-profile-description">
              Exact resume snapshots used for each application run.
            </p>
          </div>
          <span className="application-profile-badge">{applicationHistory.length} jobs</span>
        </div>

        {applicationHistory.length > 0 ? (
          <div className="application-profile-history-list">
            {applicationHistory.map(application => (
              <details key={application.id} className="application-profile-history-item">
                <summary className="application-profile-history-summary">
                  <div>
                    <strong>{application.title}</strong>
                    <span>{application.company}</span>
                  </div>
                  <span>{getAppliedResumeLabel(application)}</span>
                </summary>
                <div className="application-profile-history-body">
                  <div className="application-profile-history-meta">
                    <span>
                      Source resume:{' '}
                      {application.resumeSourceFileName || application.resumeFileName}
                    </span>
                    {application.tailoredResume && (
                      <a href={application.tailoredResume.url} target="_blank" rel="noreferrer">
                        Open Generated Resume
                      </a>
                    )}
                  </div>
                  <div className="application-profile-history-resume">
                    <p>{application.resumeContent || 'No stored resume snapshot is available.'}</p>
                  </div>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="application-profile-description">
            No application resume history yet.
          </p>
        )}
      </section>
    </>
  );
};

export default ApplicationProfilePanel;
