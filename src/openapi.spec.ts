import { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { configureOpenApi } from './main';

describe('configureOpenApi', () => {
  afterEach(() => jest.restoreAllMocks());

  it('publishes the generated OpenAPI document at /api-docs outside production', () => {
    const document = { openapi: '3.0.0' } as never;
    const createDocument = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue(document);
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    const app = {} as INestApplication;

    configureOpenApi(app, 'development');

    expect(createDocument).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        info: expect.objectContaining({ title: 'Novel Ranking API', version: '0.1' }),
      }),
    );
    expect(setup).toHaveBeenCalledWith('api-docs', app, document);
  });

  it('does not expose Swagger UI in production', () => {
    const createDocument = jest.spyOn(SwaggerModule, 'createDocument');
    const setup = jest.spyOn(SwaggerModule, 'setup');

    configureOpenApi({} as INestApplication, 'production');

    expect(createDocument).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });
});
