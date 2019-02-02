const path = require("path");

/** The global export object */
const paths = {};

/** The dest directory */
paths.dest = path.resolve(process.cwd(), "server");

/** The src directory */
paths.src = path.resolve(process.cwd(), "../all/src");

/**
 * Converts a path based on src directory to path relative to project
 * 
 * @param {string} p path based on src directory
 */
paths.toSrc = function (p) {
	return path.join(paths.src, p);
};

/**
 * Converts a path based on src directory to path relative to project
 * 
 * @param {string} p path based on src directory
 */
paths.toDest = function (p) {
	return path.join(paths.dest, p);
};

module.exports = paths;