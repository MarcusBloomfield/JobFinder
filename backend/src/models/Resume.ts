export interface Resume {
  id: string;
  fileName: string;
  fileType: 'pdf' | 'docx';
  content: string;
  skills?: string[];
  experience?: string[];
  education?: string[];
  generatedSearchTerms?: string[];
} 