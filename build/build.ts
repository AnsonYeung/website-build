/**
 * This file is responsible for minifying task.
 * It maintains the config -> dest directory.
 * All paths in this file should set the base on src directory by default.
 * (make it easy to concat)
 * All functions involving path assumes the path to be correct.
 */

import fs = require("fs-extra");
import paths = require("./paths");
import babel = require("@babel/core");
import htmlm = require("html-minifier");
import CleanCSS = require("clean-css");
import sync = require("./sync");
import minimatch = require("minimatch");
import matchOptions = require("./matchOptions");
const css = new CleanCSS({
	/** Options that passes into clean-css */
	returnPromise: true
});

interface Builder { (p: string): Promise<void> }

/**
 * Returns the modified path in config -> dest directory
 */
export function pathToDest(p: string): string {
	if (p.substr(-4, 4) === ".jsx") {
		p = p.slice(0, -1);
	}
	return p;
};

export const scripts: Builder = async function (p: string) {
	const result = await babel.transformFileAsync(paths.toSrc(p)).catch(e => {
		throw new Error("\x1b[91mBuild failure\x1b[0m at script " + p + "\n" + e);
	});
	if (result) {
		await fs.writeFile(paths.toDest(p), result.code);
	} else {
		await fs.writeFile(paths.toDest(p), "");
	}
};

export const jsx: Builder = async function (p: string) {
	const result = await babel.transformFileAsync(paths.toSrc(p), {presets: ["@babel/react"]}).catch(e => {
		throw new Error("\x1b[91mBuild failure\x1b[0m at jsx " + p + "\n" + e);
	});
	if (result) {
		await fs.writeFile(paths.toDest(pathToDest(p)), result.code);
	} else {
		await fs.writeFile(paths.toDest(pathToDest(p)), "");
	}
};

export const styles: Builder = async function (p: string) {
	const result = await css.minify(await fs.readFile(paths.toSrc(p)));
	await fs.writeFile(paths.toDest(p), result.styles);
};

export const html: Builder = async function (p: string) {
	const result = htmlm.minify((await fs.readFile(paths.toSrc(p))).toString(), {
		collapseBooleanAttributes: true,
		collapseInlineTagWhitespace: true,
		collapseWhitespace: true,
		conservativeCollapse: true,
		decodeEntities: true,
		minifyCSS: true,
		minifyJS: (text: string) => {
			const result = babel.transformSync(text);
			const c = result ? result.code : null;
			if (c) {
				return c;
			} else {
				return "";
			}
		},
		processConditionalComments: true,
		removeComments: true,
	});
	await fs.writeFile(paths.toDest(p), result);
};

export const assets: Builder = async function (p: string) {
	await fs.copy(paths.toSrc(p), paths.toDest(p));
};

/**
 * Call the builder for the specified file.
 */
export const auto: Builder = async function (p: string) {
	// special handling for sync files
	if (await sync.containsPath(p)) throw new Error("Builder doesn't exist for file " + p);

	if (paths.toRemotePath(p) === "/public_html/scripts/c2runtime.js") {
		// Special handling
		await assets(p);
		return;
	}

	if (minimatch(p, "**/*.jsx", matchOptions)) {
		await jsx(p);
	} else if (minimatch(p, "**/*.js", matchOptions)) {
		await scripts(p);
	} else if (minimatch(p, "**/*.css", matchOptions)) {
		await styles(p);
	} else if (minimatch(p, "**/*.php", matchOptions)) {
		await html(p);
	} else {
		await assets(p);
	}

};
