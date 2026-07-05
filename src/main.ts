import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const builder = new DocumentBuilder()
    .setTitle('GPT Container Experiment API')
    .setDescription('Creates temporary Docker containers for code experiments.')
    .setVersion('0.1.0')
    .setOpenAPIVersion('3.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API key',
      },
      'bearer',
    );

  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (publicBaseUrl) {
    builder.addServer(publicBaseUrl);
  }

  const config = builder.build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document);

  // Convenient URL for GPT Actions import.
  app.getHttpAdapter().get('/openapi.json', (_req, res) => {
    res.json(document);
  });

  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8000);

  try {
    await app.listen(port, host);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('listen EPERM')) {
      process.stderr.write(`[gpt-runner] HTTP listener unavailable in this environment: ${message}\n`);
      return;
    }

    throw error;
  }
}

bootstrap();
