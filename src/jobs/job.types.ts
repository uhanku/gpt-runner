export type JobState =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'deleted';

export interface JobSpec {
  goal: string;
  repo_url: string;
}

export interface JobStatus {
  job_id: string;
  status: JobState;
  created_at: string;
  updated_at: string;
  return_code: number | null;
  job?: JobSpec;
  logs_tail?: string;
}

export interface JobSummary {
  job_id: string;
  status: JobState;
  created_at: string;
  updated_at: string;
  return_code: number | null;
  job?: JobSpec;
}

export interface ReferencedFile {
  name: string;
  download_url?: string;
  download_link?: string;
}
