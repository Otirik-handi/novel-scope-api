import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureOpenApi(app: INestApplication): void {
  if (process.env.NODE_ENV === 'production') return;

  const config = new DocumentBuilder()
    .setTitle('Novel Ranking API')
    .setDescription('Qidian ranking snapshots and on-demand book details.')
    .setVersion('0.1')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'refreshApiKey')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document);
}
