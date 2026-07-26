import { ValidationPipe } from "@nestjs/common";
import { type ConfigType } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import appConfig from "./config/app.config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const applicationConfig = app.get<ConfigType<typeof appConfig>>(
    appConfig.KEY,
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("NovelScope API")
    .setDescription("小说数据查询与刷新 API")
    .setVersion("0.2.1")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api-docs", app, document);

  await app.listen(applicationConfig.port);
}

void bootstrap();
