import { Schema } from 'mongoose';

export interface JobLogDocument {
  jobId: string;
  text: string;
  created_at: Date;
}

export const JOB_LOG_MODEL_NAME = 'JobLogEntry';

export const jobLogSchema = new Schema<JobLogDocument>(
  {
    jobId: {
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
    id: false,
    versionKey: false,
  },
);

jobLogSchema.index({ jobId: 1, created_at: -1 });
