import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import mongoose, { Connection, Model } from 'mongoose';
import {
  AVAILABLE_DOCKER_IMAGE_MODEL_NAME,
  availableDockerImageSchema,
  type AvailableDockerImageDocument,
} from '../schemas/available-docker-image.schema';

@Injectable()
export class AvailableDockerImagesStore {
  private readonly uri: string;
  private readonly databaseName: string;
  private readonly collectionName: string;
  private connection?: Connection;
  private imageModel?: Model<AvailableDockerImageDocument>;

  constructor() {
    this.uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
    this.databaseName = process.env.MONGO_DB || 'gpt_runner';
    this.collectionName = 'available_docker_images';
  }

  async onModuleInit() {
    const connection = mongoose.createConnection(this.uri, {
      dbName: this.databaseName,
      serverSelectionTimeoutMS: 5000,
    });

    this.connection = await connection.asPromise();
    this.imageModel = this.connection.model<AvailableDockerImageDocument>(
      AVAILABLE_DOCKER_IMAGE_MODEL_NAME,
      availableDockerImageSchema,
      this.collectionName,
    );

    await this.imageModel.init();
  }

  async onModuleDestroy() {
    if (this.connection) {
      await this.connection.close();
    }
  }

  async upsert(image: AvailableDockerImageDocument) {
    await this.imagesModel().updateOne(
      { name: image.name },
      { $set: image },
      { upsert: true },
    );
  }

  private imagesModel(): Model<AvailableDockerImageDocument> {
    if (!this.imageModel) {
      throw new InternalServerErrorException(
        'Mongo available docker image store is not ready.',
      );
    }

    return this.imageModel;
  }
}
