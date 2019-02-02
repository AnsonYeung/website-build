const paths = require("./paths");

/**
 * @type {import("minimatch").IOptions}
 */
module.exports = {
	cwd: paths.src,
	nosort: true,
	nodir: true,
	dot: true
};