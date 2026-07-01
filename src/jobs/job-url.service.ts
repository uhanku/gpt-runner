import { Injectable } from '@nestjs/common';

@Injectable()
export class JobUrlService {
  public publicBaseUrl(fallbackBaseUrl?: string): string {
    return (process.env.PUBLIC_BASE_URL || fallbackBaseUrl || '').replace(
      /\/+$/,
      '',
    );
  }

  public absoluteUrl(baseUrl: string, pathAndQuery: string): string {
    return baseUrl ? `${baseUrl}${pathAndQuery}` : pathAndQuery;
  }
}
