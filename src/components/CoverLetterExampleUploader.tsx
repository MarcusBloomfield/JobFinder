import React from 'react';
import { CoverLetterExample } from '../models/CoverLetterExample';

interface CoverLetterExampleUploaderProps {
  examples: CoverLetterExample[];
  isLoading: boolean;
  message: string | null;
  onUpload: (file: File) => Promise<void>;
  onRemove: (exampleId: string) => void;
}

const CoverLetterExampleUploader: React.FC<CoverLetterExampleUploaderProps> = ({
  examples,
  isLoading,
  message,
  onUpload,
  onRemove
}) => {
  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (file) {
      void onUpload(file);
    }
  };

  return (
    <div className="front-page-cover-letter-panel">
      <div className="front-page-cover-letter-header">
        <div>
          <h3>Cover Letter Examples</h3>
          <p className="application-profile-description">
            Upload PDF or DOCX examples for the generated cover-letter documents.
          </p>
        </div>
        <label className="cover-letter-example-upload-button">
          {isLoading ? 'Uploading...' : 'Upload'}
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={isLoading}
            onChange={handleUpload}
          />
        </label>
      </div>

      {message && <p className="cover-letter-example-message">{message}</p>}

      {examples.length > 0 ? (
        <div className="cover-letter-example-list">
          {examples.map(example => (
            <div key={example.id} className="cover-letter-example-card">
              <div>
                <strong>{example.fileName}</strong>
                <span>
                  {example.fileType.toUpperCase()}
                  {example.uploadedAt ? ` - ${new Date(example.uploadedAt).toLocaleDateString()}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="cover-letter-example-remove"
                onClick={() => onRemove(example.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="stored-resumes-empty">No cover letter examples yet.</p>
      )}
    </div>
  );
};

export default CoverLetterExampleUploader;
