/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testEnvironment: "node",
  testRegex: ".*\\.spec\\.ts$",
  testPathIgnorePatterns: ["/node_modules/", "/test/e2e/"],
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
};
