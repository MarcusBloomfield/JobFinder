export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  location?: string;
  salary?: string;
  datePosted?: string;
  matchScore?: number;
  isFavorite?: boolean;
  applicationStatus?: 'idle' | 'applying' | 'applied' | 'review_required' | 'failed' | 'skipped';
  applicationMessage?: string;
  applicationLogs?: string[];
} 
