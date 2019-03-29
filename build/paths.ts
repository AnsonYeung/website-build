import path = require("path");

/** The dest directory */
export const dest = path.resolve(process.cwd(), "server");

/** The src directory */
export const src = path.resolve(process.cwd(), "../src");

/**
 * Converts a path based on src directory to path relative to project
 */
export function toSrc(p: string) {
	return path.join(src, p);
};

/**
 * Converts a path based on src directory to path relative to project
 */
export function toDest(p: string) {
	return path.join(dest, p);
};

/**
 * Converts a path to remote path
 */
export function toRemotePath(p: string): string {
	return path.posix.join("/", p.split(path.sep).join(path.posix.sep));
};