export type JobState = 'queued' | 'running' | 'success' | 'failed' | 'timeout' | 'deleted';

export interface JobSpec {
  goal: string;
  repo_url?: string;
}

export interface JobRecord {
  _id: string;
  status: JobState;
  created_at: string;
  updated_at: string;
  return_code: number | null;
  goal: string;
  repo_url?: string;
  available_job_id: string;
}

export interface JobStatus extends JobRecord {
  docker_image_name: string;
  logs_tail?: string;
}

export interface JobSummary extends JobRecord {
  docker_image_name: string;
}

export interface ReferencedFile {
  name: string;
  download_url?: string;
  download_link?: string;
}
