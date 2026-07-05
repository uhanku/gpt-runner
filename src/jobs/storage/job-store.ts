import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import mongoose, { Connection, Model } from 'mongoose';
import { JOB_MODEL_NAME, jobSchema, type JobDocument } from '../schemas/job.schema';
import type { JobStatus, JobSummary } from '../shared/job.types';

@Injectable()
export class JobStore {
  private readonly uri: string;
  private readonly databaseName: string;
  private readonly collectionName: string;
  private connection?: Connection;
  private jobModel?: Model<JobDocument>;

  constructor() {
    this.uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
    this.databaseName = process.env.MONGO_DB || 'gpt_runner';
    this.collectionName = 'jobs';
  }

  async onModuleInit() {
    const connection = mongoose.createConnection(this.uri, {
      dbName: this.databaseName,
      serverSelectionTimeoutMS: 5000,
    });

    this.connection = await connection.asPromise();
    this.jobModel = this.connection.model<JobDocument>(JOB_MODEL_NAME, jobSchema, this.collectionName);

    await this.jobModel.init();
  }

  async onModuleDestroy() {
    if (this.connection) {
      await this.connection.close();
    }
  }

  async writeJob(jobId: string, status: JobStatus) {
    const filter = { _id: new mongoose.Types.ObjectId(jobId) };
    const { _id, ...update } = status;

    await this.jobsModel().updateOne(filter, { $set: update }, { upsert: true });
  }

  async readJob(jobId: string): Promise<JobStatus> {
    const document = await this.jobsModel().findOne({ _id: new mongoose.Types.ObjectId(jobId) }).lean();

    if (!document) {
      throw new NotFoundException('Job not found');
    }

    return normalizeJobRecord(document as JobDocument);
  }

  async deleteJob(jobId: string) {
    await this.jobsModel().deleteOne({ _id: new mongoose.Types.ObjectId(jobId) });
  }

  async listJobs(): Promise<JobSummary[]> {
    const documents = await this.jobsModel().find({}).sort({ updated_at: -1, created_at: -1, _id: -1 }).lean();

    return documents.map((document) => normalizeJobRecord(document as JobDocument));
  }

  async listQueuedJobs(): Promise<JobSummary[]> {
    const documents = await this.jobsModel().find({ status: 'queued' }).sort({ updated_at: -1, created_at: -1, _id: -1 }).lean();

    return documents.map((document) => normalizeJobRecord(document as JobDocument));
  }

  private jobsModel(): Model<JobDocument> {
    if (!this.jobModel) {
      throw new InternalServerErrorException('Mongo job store is not ready.');
    }

    return this.jobModel;
  }
}

function normalizeJobRecord(document: JobDocument): JobStatus {
  const goal = typeof document.goal === 'string' ? document.goal : undefined;

  if (goal === undefined) {
    throw new InternalServerErrorException('Job document is missing goal.');
  }

  const repo_url = typeof document.repo_url === 'string' ? document.repo_url : undefined;

  return {
    _id: String(document._id),
    status: document.status,
    created_at: document.created_at,
    updated_at: document.updated_at,
    return_code: document.return_code,
    goal,
    ...(repo_url !== undefined ? { repo_url } : {}),
    available_job_id: document.available_job_id,
    docker_image_name: document.docker_image_name,
  };
}
