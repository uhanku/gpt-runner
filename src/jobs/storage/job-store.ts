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
    const filter = { job_id: jobId };
    const update = { ...status };

    await this.jobsModel().updateOne(filter, { $set: update }, { upsert: true });
  }

  async readJob(jobId: string): Promise<JobStatus> {
    const document = await this.jobsModel().findOne({ job_id: jobId }).lean();

    if (!document) {
      throw new NotFoundException('Job not found');
    }

    const { _id, ...record } = document as JobDocument & { _id?: unknown };
    return normalizeJobRecord(record);
  }

  async deleteJob(jobId: string) {
    await this.jobsModel().deleteOne({ job_id: jobId });
  }

  async listJobs(): Promise<JobSummary[]> {
    const documents = await this.jobsModel()
      .find({}, { _id: 0 })
      .sort({ updated_at: -1, created_at: -1, job_id: -1 })
      .lean();

    return documents.map((document) => normalizeJobRecord(document as JobDocument));
  }

  async listQueuedJobs(): Promise<JobSummary[]> {
    const documents = await this.jobsModel()
      .find({ status: 'queued' }, { _id: 0 })
      .sort({ updated_at: -1, created_at: -1, job_id: -1 })
      .lean();

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
  const goal =
    typeof document.goal === 'string'
      ? document.goal
      : typeof document.job?.goal === 'string'
        ? document.job.goal
        : undefined;

  if (goal === undefined) {
    throw new InternalServerErrorException('Job document is missing goal.');
  }

  const repo_url =
    typeof document.repo_url === 'string'
      ? document.repo_url
      : typeof document.job?.repo_url === 'string'
        ? document.job.repo_url
        : undefined;

  const { job: _job, ...rest } = document;

  return {
    ...rest,
    goal,
    ...(repo_url !== undefined ? { repo_url } : {}),
  };
}
