import React, { useState } from 'react';
import type { CustomApplicationJobInput } from '../hooks/useJobSearch';

interface CustomApplicationFormProps {
  onAddJob: (input: CustomApplicationJobInput) => Promise<void>;
  isDisabled: boolean;
}

const EMPTY_FORM: CustomApplicationJobInput = {
  url: '',
  company: '',
  title: '',
  location: '',
  description: ''
};

const validateForm = (form: CustomApplicationJobInput): string | null => {
  if (!form.url.trim()) {
    return 'Enter an application URL.';
  }

  if (!form.company.trim()) {
    return 'Enter the company.';
  }

  if (!form.title.trim()) {
    return 'Enter the job title.';
  }

  if (!form.location.trim()) {
    return 'Enter the location.';
  }

  return null;
};

const CustomApplicationForm: React.FC<CustomApplicationFormProps> = ({
  onAddJob,
  isDisabled
}) => {
  const [form, setForm] = useState<CustomApplicationJobInput>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = (field: keyof CustomApplicationJobInput, value: string): void => {
    setForm(currentForm => ({
      ...currentForm,
      [field]: value
    }));
    setError(null);
    setMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (isDisabled || isSubmitting) {
      return;
    }

    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      await onAddJob(form);
      setForm(EMPTY_FORM);
      setMessage('Custom job card added.');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not add job card.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="custom-application-form-section" aria-labelledby="custom-application-heading">
      <div className="custom-application-form-header">
        <h3 id="custom-application-heading">Custom Application URL</h3>
      </div>
      <form className="custom-application-form" noValidate onSubmit={event => void handleSubmit(event)}>
        <div className="custom-application-grid">
          <label>
            <span>URL</span>
            <input
              type="text"
              inputMode="url"
              value={form.url}
              placeholder="https://company.com/careers/apply"
              disabled={isDisabled || isSubmitting}
              required
              onChange={event => updateField('url', event.target.value)}
            />
          </label>
          <label>
            <span>Company</span>
            <input
              type="text"
              value={form.company}
              disabled={isDisabled || isSubmitting}
              required
              onChange={event => updateField('company', event.target.value)}
            />
          </label>
          <label>
            <span>Title</span>
            <input
              type="text"
              value={form.title}
              disabled={isDisabled || isSubmitting}
              required
              onChange={event => updateField('title', event.target.value)}
            />
          </label>
          <label>
            <span>Location</span>
            <input
              type="text"
              value={form.location}
              disabled={isDisabled || isSubmitting}
              required
              onChange={event => updateField('location', event.target.value)}
            />
          </label>
        </div>
        <label className="custom-application-description">
          <span>Description</span>
          <textarea
            value={form.description}
            rows={3}
            disabled={isDisabled || isSubmitting}
            onChange={event => updateField('description', event.target.value)}
          />
        </label>
        <div className="custom-application-actions">
          <button type="submit" disabled={isDisabled || isSubmitting}>
            {isSubmitting ? 'Adding...' : 'Add Job Card'}
          </button>
          {error && (
            <span className="custom-application-error" role="alert">
              {error}
            </span>
          )}
          {message && (
            <span className="custom-application-message" aria-live="polite">
              {message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
};

export default CustomApplicationForm;
