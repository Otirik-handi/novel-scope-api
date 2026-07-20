import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppEnvironment } from './config/env.validation';
import { configureOpenApi } from './openapi';

export function configureTrustProxy(app: INestApplication, trustProxy: AppEnvironment['trustProxy']): void {
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  configureTrustProxy(app, config.getOrThrow<AppEnvironment['trustProxy']>('trustProxy'));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  configureOpenApi(app);
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(process.env.PORT ?? 3000);
}

if (require.main === module) void bootstrap();
