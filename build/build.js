/**
 * This file is responsible for minifying task.
 * It maintains the config -> dest directory.
 * All paths in this file should set the base on src directory by default.
 * (make it easy to concat)
 * All functions involving path assumes the path to be correct.
 */

/**
 * @callback Builder
 * @param {string} p path based on src directory
 * @returns {Promise<void>} resolve when done
 */

const fs = require("fs-extra");
const paths = require("./paths");
const babel = require("@babel/core");
const html = require("html-minifier");
const CleanCSS = require("clean-css");
const sync = require("./sync");
const minimatch  = require("minimatch");
const matchOptions = require("./matchOptions");
const css = new CleanCSS({
	/** Options that passes into clean-css */
	// @ts-ignore
	returnPromise: true
});

// The export object on this file
const build = {};

/**
 * @param {string} p path based on src directory
 * @returns {string} modified path in config -> dest directory
 */
build.pathToDest = function (p) {
	if (p.substr(-4, 4) === ".jsx") {
		p = p.slice(0, -1);
	}
	return p;
};

/**
 * @type {Builder}
 */
build.scripts = async function (p) {
	const result = await babel.transformFileAsync(paths.toSrc(p));
	await fs.writeFile(paths.toDest(p), result.code);
};

/**
 * @type {Builder}
 */
build.jsx = async function (p) {
	const result = await babel.transformFileAsync(paths.toSrc(p), {presets: ["@babel/react"]});
	await fs.writeFile(paths.toDest(build.pathToDest(p)), result.code);
};

/**
 * @type {Builder}
 */
build.styles = async function (p) {
	const result = await css.minify(await fs.readFile(paths.toSrc(p)));
	await fs.writeFile(paths.toDest(p), result.styles);
};

/**
 * @type {Builder}
 */
build.html = async function (p) {
	const result = html.minify((await fs.readFile(paths.toSrc(p))).toString());
	await fs.writeFile(paths.toDest(p), result);
};

/**
 * @type {Builder}
 */
build.assets = async function (p) {
	await fs.copy(paths.toSrc(p), paths.toDest(p));
};

/**
 * Call the builder for the specified file.
 * 
 * @param {string} p path based on src directory
 * @returns {Promise<void>}
 */
build.auto = async function (p) {
	// special handling for sync files
	if (await sync.containsPath(p)) throw new Error("Builder doesn't exist for file " + p);

	if (p === "public_html\\scripts\\c2runtime.js" || p === "public_html\\scripts\\require.js") {
		// Special handling
		await build.assets(p);
		return;
	}

	if (minimatch(p, "**/*.jsx", matchOptions)) {
		await build.jsx(p);
	} else if (minimatch(p, "**/*.js", matchOptions)) {
		await build.scripts(p);
	} else if (minimatch(p, "**/*.css", matchOptions)) {
		await build.styles(p);
	} else if (minimatch(p, "**/*.html", matchOptions) || minimatch(p, "**/*.php", matchOptions)) {
		await build.html(p);
	} else {
		await build.assets(p);
	}

};

module.exports = build;
