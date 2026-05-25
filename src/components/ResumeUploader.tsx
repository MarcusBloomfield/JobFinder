import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Resume } from '../models/Resume';

interface ResumeUploaderProps {
  onUpload: (file: File) => Promise<void>;
  onSelectStoredResume: (resumeId: string) => Promise<void>;
  storedResumes: Resume[];
  selectedResumeId?: string;
  isLoading: boolean;
  isStoredResumesLoading: boolean;
}

const ResumeUploader: React.FC<ResumeUploaderProps> = ({
  onUpload,
  onSelectStoredResume,
  storedResumes,
  selectedResumeId,
  isLoading,
  isStoredResumesLoading
}) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        onUpload(file);
      }
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
    },
    maxFiles: 1,
    multiple: false
  });

  const hasRejectedFiles = fileRejections.length > 0;

  return (
    <div className="resume-uploader">
      <div
        {...getRootProps()}
        className={`dropzone ${isDragActive ? 'active' : ''} ${
          hasRejectedFiles ? 'rejected' : ''
        }`}
      >
        <input {...getInputProps()} />
        
        {isLoading ? (
          <div className="loading-indicator">
            <p>Processing resume...</p>
            <div className="spinner"></div>
          </div>
        ) : (
          <>
            {isDragActive ? (
              <p>Drop your resume here...</p>
            ) : (
              <div className="upload-content">
                <svg
                  width="50"
                  height="50"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="18" x2="12" y2="12"></line>
                  <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
                <p>
                  Drag & drop your resume here
                  <br />
                  <span className="text-small">or click to browse files</span>
                </p>
                <p className="file-format">Supported formats: PDF, DOCX</p>
              </div>
            )}
            
            {hasRejectedFiles && (
              <p className="error-message">
                Please upload a PDF or DOCX file
              </p>
            )}
          </>
        )}
      </div>

      <div className="stored-resumes-panel">
        <div className="stored-resumes-header">
          <h3>Stored Resumes</h3>
          {isStoredResumesLoading && <span className="stored-resumes-status">Loading...</span>}
        </div>

        {storedResumes.length > 0 ? (
          <div className="stored-resume-list">
            {storedResumes.map((resume) => {
              const isSelected = selectedResumeId === resume.id;

              return (
                <button
                  key={resume.id}
                  type="button"
                  className={`stored-resume-card ${isSelected ? 'selected' : ''}`}
                  disabled={isLoading}
                  onClick={() => void onSelectStoredResume(resume.id)}
                >
                  <span className="stored-resume-name">{resume.fileName}</span>
                  <span className="stored-resume-meta">
                    {resume.fileType.toUpperCase()}
                    {resume.uploadedAt ? ` • ${new Date(resume.uploadedAt).toLocaleDateString()}` : ''}
                  </span>
                  {isSelected && <span className="stored-resume-selected">Selected</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="stored-resumes-empty">No stored resumes yet. Upload one to keep it for later.</p>
        )}
      </div>
    </div>
  );
};

export default ResumeUploader; 
