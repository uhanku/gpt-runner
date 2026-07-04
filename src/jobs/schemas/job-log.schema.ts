import { Schema } from 'mongoose';

export interface JobLogDocument {
  job_id: string;
  text: string;
  created_at: Date;
}

export const JOB_LOG_MODEL_NAME = 'JobLogEntry';

export const jobLogSchema = new Schema<JobLogDocument>(
  {
    job_id: {
      type: String,
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
    },
    created_at: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    versionKey: false,
  },
);

jobLogSchema.index({ job_id: 1, created_at: -1 });
