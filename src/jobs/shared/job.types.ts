export type JobState = 'queued' | 'running' | 'success' | 'failed' | 'timeout' | 'deleted';

export interface JobSpec {
  goal: string;
  repo_url?: string;
}

export interface JobStatus {
  _id: string;
  status: JobState;
  created_at: string;
  updated_at: string;
  return_code: number | null;
  goal: string;
  repo_url?: string;
  available_job_id: string;
  docker_image_name: string;
  logs_tail?: string;
}

export interface JobSummary {
  _id: string;
  status: JobState;
  created_at: string;
  updated_at: string;
  return_code: number | null;
  goal: string;
  repo_url?: string;
  available_job_id: string;
  docker_image_name: string;
}

export interface ReferencedFile {
  name: string;
  download_url?: string;
  download_link?: string;
}
