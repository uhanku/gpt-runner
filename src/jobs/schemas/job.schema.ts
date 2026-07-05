import { Schema, type Types } from 'mongoose';
import type { JobState } from '../shared/job.types';

export interface JobDocument {
  _id: Types.ObjectId;
  status: JobState;
  created_at: string;
  updated_at: string;
  return_code: number | null;
  goal: string;
  repo_url?: string;
  available_job_id: string;
  docker_image_name: string;
}

export const JOB_MODEL_NAME = 'Job';

export const jobSchema = new Schema<JobDocument>(
  {
    status: {
      type: String,
      required: true,
      index: true,
    },
    created_at: {
      type: String,
      required: true,
      index: true,
    },
    updated_at: {
      type: String,
      required: true,
      index: true,
    },
    return_code: {
      type: Number,
      required: true,
      default: null,
    },
    goal: {
      type: String,
      required: true,
    },
    repo_url: {
      type: String,
    },
    available_job_id: {
      type: String,
      required: true,
      index: true,
    },
    docker_image_name: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    id: false,
    versionKey: false,
    minimize: false,
  },
);

jobSchema.index({ status: 1, updated_at: -1, created_at: -1 });
