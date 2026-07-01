import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class ArtifactSignerService {
  signArtifactPath(jobId: string, artifactPath: string): string {
    const secret = this.publicArtifactSecret();

    return createHmac('sha256', secret)
      .update(this.artifactSignaturePayload(jobId, artifactPath), 'utf8')
      .digest('hex');
  }

  verifyArtifactSignature(
    jobId: string,
    artifactPath: string,
    signature: string,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Missing artifact signature');
    }

    if (!/^[0-9a-f]{64}$/i.test(signature)) {
      throw new UnauthorizedException('Invalid artifact signature');
    }

    const expected = Buffer.from(
      this.signArtifactPath(jobId, artifactPath),
      'hex',
    );
    const actual = Buffer.from(signature, 'hex');

    if (!timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Invalid artifact signature');
    }
  }

  artifactSignaturePayload(jobId: string, artifactPath: string): string {
    return `${jobId}\n${artifactPath}`;
  }

  publicArtifactSecret(): string {
    const secret = process.env.PUBLIC_ARTIFACT_SECRET;

    if (!secret) {
      throw new InternalServerErrorException(
        'Server misconfigured: PUBLIC_ARTIFACT_SECRET is not set.',
      );
    }

    return secret;
  }
}
