const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/test/setup-env.ts"],
  testMatch: ["**/src/**/*.spec.ts", "**/test/**/*.e2e-spec.ts"],
  transform: {
    ...tsJestTransformCfg,
  },
};
