import { Schema } from 'mongoose';

export interface AvailableJobDocument {
  name: string;
  goal: string;
}

export interface AvailableJobSummary {
  id: string;
  name: string;
  goal: string;
}

export const AVAILABLE_JOB_MODEL_NAME = 'AvailableJob';

export const availableJobSchema = new Schema<AvailableJobDocument>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    goal: {
      type: String,
      required: true,
    },
  },
  {
    versionKey: false,
    minimize: false,
  },
);
