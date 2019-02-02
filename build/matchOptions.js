const path = require("path");

/**
 * @type {import("minimatch").IOptions}
 */
module.exports = {
	cwd: path.join(process.cwd(), "src"),
	nosort: true,
	nodir: true,
	dot: true
};