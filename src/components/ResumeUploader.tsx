import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface ResumeUploaderProps {
  onUpload: (file: File) => Promise<void>;
  isLoading: boolean;
}

const ResumeUploader: React.FC<ResumeUploaderProps> = ({ onUpload, isLoading }) => {
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
    </div>
  );
};

export default ResumeUploader; 