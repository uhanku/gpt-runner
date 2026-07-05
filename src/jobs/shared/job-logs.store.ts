import { Injectable, InternalServerErrorException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import mongoose, { Connection, Model } from 'mongoose';
import { JOB_LOG_MODEL_NAME, JobLogDocument, jobLogSchema } from '../schemas/job-log.schema';

export interface RecentJobLogEntry {
  jobId: string;
  text: string;
  created_at: string;
}

@Injectable()
export class JobLogsStore implements OnModuleInit, OnModuleDestroy {
  private readonly uri: string;
  private readonly databaseName: string;
  private readonly collectionName: string;
  private connection?: Connection;
  private logModel?: Model<JobLogDocument>;

  constructor() {
    this.uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
    this.databaseName = process.env.MONGO_DB || 'gpt_runner';
    this.collectionName = process.env.MONGO_LOGS_COLLECTION || 'job_logs';
  }

  async onModuleInit() {
    const connection = mongoose.createConnection(this.uri, {
      dbName: this.databaseName,
      serverSelectionTimeoutMS: 5000,
    });

    this.connection = await connection.asPromise();
    this.logModel = this.connection.model<JobLogDocument>(JOB_LOG_MODEL_NAME, jobLogSchema, this.collectionName);

    await this.logModel.init();
  }

  async onModuleDestroy() {
    if (this.connection) {
      await this.connection.close();
    }
  }

  async append(jobId: string, text: string) {
    if (!text) {
      return;
    }

    await this.logsModel().create({
      jobId,
      text,
      created_at: new Date(),
    });
  }

  async tail(jobId: string, maxBytes: number): Promise<string> {
    if (maxBytes <= 0) {
      return '';
    }

    const cursor = this.logsModel()
      .find({ jobId }, { text: 1, _id: 0 })
      .sort({ created_at: -1, _id: -1 })
      .cursor();

    const chunks: string[] = [];
    let collectedBytes = 0;

    for await (const entry of cursor) {
      chunks.push(entry.text);
      collectedBytes += Buffer.byteLength(entry.text, 'utf8');

      if (collectedBytes >= maxBytes) {
        break;
      }
    }

    if (chunks.length === 0) {
      return '';
    }

    const buffer = Buffer.from(chunks.reverse().join(''), 'utf8');
    return buffer.length > maxBytes
      ? buffer.subarray(buffer.length - maxBytes).toString('utf8')
      : buffer.toString('utf8');
  }

  async deleteByJobId(jobId: string) {
    await this.logsModel().deleteMany({ jobId });
  }

  async recent(limit = 50): Promise<RecentJobLogEntry[]> {
    if (limit <= 0) {
      return [];
    }

    const cursor = this.logsModel()
      .find({}, { jobId: 1, text: 1, created_at: 1, _id: 0 })
      .sort({ created_at: -1, _id: -1 })
      .limit(limit)
      .cursor();

    const entries: RecentJobLogEntry[] = [];

    for await (const entry of cursor) {
      entries.push({
        jobId: entry.jobId,
        text: entry.text,
        created_at: entry.created_at.toISOString(),
      });
    }

    return entries;
  }

  private logsModel(): Model<JobLogDocument> {
    if (!this.logModel) {
      throw new InternalServerErrorException('Mongo log store is not ready.');
    }

    return this.logModel;
  }
}
