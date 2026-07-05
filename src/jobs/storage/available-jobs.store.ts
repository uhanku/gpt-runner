import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import mongoose, { Connection, Model } from 'mongoose';
import { AVAILABLE_JOB_MODEL_NAME, availableJobSchema, type AvailableJobDocument, type AvailableJobSummary } from '../schemas/available-job.schema';

@Injectable()
export class AvailableJobsStore {
  private readonly uri: string;
  private readonly databaseName: string;
  private readonly collectionName: string;
  private connection?: Connection;
  private jobModel?: Model<AvailableJobDocument>;

  constructor() {
    this.uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
    this.databaseName = process.env.MONGO_DB || 'gpt_runner';
    this.collectionName = 'available_jobs';
  }

  async onModuleInit() {
    const connection = mongoose.createConnection(this.uri, {
      dbName: this.databaseName,
      serverSelectionTimeoutMS: 5000,
    });

    this.connection = await connection.asPromise();
    this.jobModel = this.connection.model<AvailableJobDocument>(AVAILABLE_JOB_MODEL_NAME, availableJobSchema, this.collectionName);

    await this.jobModel.init();
  }

  async onModuleDestroy() {
    if (this.connection) {
      await this.connection.close();
    }
  }

  async upsert(job: AvailableJobDocument) {
    await this.availableJobsModel().updateOne({ name: job.name }, { $set: job }, { upsert: true });
  }

  async listJobs(): Promise<AvailableJobSummary[]> {
    const documents = await this.availableJobsModel()
      .find({}, { _id: 1, name: 1, goal: 1 })
      .sort({ name: 1 })
      .lean();

    return documents.map((document) => normalizeAvailableJobRecord(document as AvailableJobDocument & { _id: unknown }));
  }

  async getJob(jobId: string): Promise<AvailableJobSummary> {
    const document = await this.availableJobsModel().findById(jobId, { _id: 1, name: 1, goal: 1 }).lean();

    if (!document) {
      throw new NotFoundException('Available job not found');
    }

    return normalizeAvailableJobRecord(document as AvailableJobDocument & { _id: unknown });
  }

  private availableJobsModel(): Model<AvailableJobDocument> {
    if (!this.jobModel) {
      throw new InternalServerErrorException('Mongo available job store is not ready.');
    }

    return this.jobModel;
  }
}

function normalizeAvailableJobRecord(document: AvailableJobDocument & { _id: unknown }): AvailableJobSummary {
  return {
    id: String(document._id),
    name: document.name,
    goal: document.goal,
  };
}
