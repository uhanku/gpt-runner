import { Schema } from 'mongoose';

export interface AvailableDockerImageDocument {
  name: string;
  goal: string;
}

export const AVAILABLE_DOCKER_IMAGE_MODEL_NAME = 'AvailableDockerImage';

export const availableDockerImageSchema = new Schema<AvailableDockerImageDocument>(
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
