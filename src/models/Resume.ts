export interface Resume {
  id: string;
  fileName: string;
  fileType: 'pdf' | 'docx';
  content: string;
  uploadedAt?: string;
  storedFileName?: string;
  skills?: string[];
  experience?: string[];
  education?: string[];
  generatedSearchTerms?: string[];
} 
