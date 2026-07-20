const baseConfig = require("./jest.config");

module.exports = {
  ...baseConfig,
  roots: ["<rootDir>/test/e2e"],
  testRegex: ".*\\.e2e-spec\\.ts$",
  testPathIgnorePatterns: ["/node_modules/"],
};
