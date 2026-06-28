import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_ROUTE } from './public-route.decorator';

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublicRoute = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ROUTE,
      [context.getHandler(), context.getClass()],
    );

    if (isPublicRoute) {
      return true;
    }

    const apiKey = process.env.ACTION_API_KEY;

    if (!apiKey) {
      throw new InternalServerErrorException(
        'Server misconfigured: ACTION_API_KEY is not set.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;

    if (authorization !== `Bearer ${apiKey}`) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
