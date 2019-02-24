const path = require("path");

/** The global export object */
const paths = {};

/** The dest directory */
paths.dest = path.resolve(process.cwd(), "server");

/** The src directory */
paths.src = path.resolve(process.cwd(), "../src");

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

/**
 * Converts a path to remote path
 * 
 * @param {string} p path based on src directory
 * @returns {string} remote path
 */
paths.toRemotePath = function (p) {
	return path.posix.join("/", p.split(path.sep).join(path.posix.sep));
};

module.exports = paths;