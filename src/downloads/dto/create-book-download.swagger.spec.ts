import { join } from "node:path";
import { createRequire } from "node:module";
import type { before as SwaggerPluginBefore } from "@nestjs/swagger/dist/plugin";
import * as ts from "typescript";

const nodeRequire = createRequire(__filename);
const swaggerPlugin = nodeRequire("@nestjs/swagger/plugin") as {
  before: typeof SwaggerPluginBefore;
};
const { before } = swaggerPlugin;

describe("CreateBookDownloadDto Swagger metadata", () => {
  it("does not expose the validation-only marker property to OpenAPI", () => {
    const fileName = join(__dirname, "create-book-download.dto.ts");
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      skipLibCheck: true,
    };
    const host = ts.createCompilerHost(options);
    const program = ts.createProgram([fileName], options, host);
    let emitted = "";

    const result = program.emit(
      undefined,
      (outputName, text) => {
        if (outputName.endsWith(".js")) {
          emitted = text;
        }
      },
      undefined,
      false,
      { before: [before(undefined, program)] },
    );

    expect(result.emitSkipped).toBe(false);
    expect(emitted).toContain("_OPENAPI_METADATA_FACTORY");
    expect(emitted).not.toMatch(/chapterRangeOrder:\s*\{/);
  });
});
