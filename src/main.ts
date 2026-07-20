import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppEnvironment } from './config/env.validation';

export function configureTrustProxy(app: INestApplication, trustProxy: AppEnvironment['trustProxy']): void {
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
}

export function configureOpenApi(app: INestApplication, nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === 'production') return;

  const config = new DocumentBuilder()
    .setTitle('Novel Ranking API')
    .setDescription('起点中文网榜单历史快照与书籍详情 API')
    .setVersion('0.1')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'refresh-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);
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
