import { ValidationPipe } from "@nestjs/common";
import { type ConfigType } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import appConfig from "./config/app.config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const applicationConfig = app.get<ConfigType<typeof appConfig>>(
    appConfig.KEY,
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  await app.listen(applicationConfig.port);
}

void bootstrap();
