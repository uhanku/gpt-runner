import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

@Injectable()
export class UploadRequestBodyLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('JobsController');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const jobId = request.params.jobId ?? 'unknown';

    this.logger.log(
      `POST /jobs/${jobId}/files request body: ${this.stringifyBody(
        request.body,
      )}`,
    );

    return next.handle();
  }

  private stringifyBody(body: unknown): string {
    try {
      return JSON.stringify(body ?? {});
    } catch {
      return '[unserializable request body]';
    }
  }
}
