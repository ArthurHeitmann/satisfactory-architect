import { readFileSync, readdirSync, writeFileSync } from "fs";
import argsParser from "args-parser";
import { satisfactoryDatabase } from "../src/lib/satisfactoryDatabase";
import { join } from "path";

async function main() {
	const args = argsParser(process.argv);
	const folder = args["folder"];
	const savePath = args["save"];
	if (!folder) {
		throw new Error("Please provide the folder path using --folder=<path>.");
	}
	if (!savePath) {
		throw new Error("Please provide the save path using --save=<path>.");
	}

	const iconPreviews: Record<string, string> = {};

	for (const icon of Object.values(satisfactoryDatabase.icons)) {
		const minResolution = Math.min(...icon.resolutions);
		if (minResolution > 64) {
			continue;
		}
		const iconPath = join(folder, `${icon.name}_${minResolution}.webp`);
		try {
			const iconData = readFileSync(iconPath);
			const base64Icon = iconData.toString("base64");
			iconPreviews[icon.name] = `data:image/webp;base64,${base64Icon}`;
		} catch (err) {
			console.warn(`Could not read icon file: ${iconPath}. Error: ${err}`);
		}
	}

	let fileString = "export const iconPreviews: Record<string, string> = ";
	fileString += JSON.stringify(iconPreviews, null, "\t") + ";\n";

	writeFileSync(savePath, fileString, "utf-8");
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});