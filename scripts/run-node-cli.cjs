const { spawnSync } = require("node:child_process");

function runNodeCli(moduleId, args, options) {
  return spawnSync(process.execPath, [require.resolve(moduleId), ...args], options);
}

module.exports = { runNodeCli };
