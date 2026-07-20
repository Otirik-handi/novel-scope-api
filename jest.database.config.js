const baseConfig = require("./jest.config");

module.exports = {
  ...baseConfig,
  testMatch: ["<rootDir>/test/e2e/**/*.e2e-spec.ts"],
  testRegex: undefined,
  testPathIgnorePatterns: ["/node_modules/"],
};
