import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import argsParser from "args-parser";

function parseFullName(fullName: string): string {
	const name = fullName.split(".").at(-1);
	if (!name) {
		throw new Error(`Invalid full name: ${fullName}`);
	}
	return name.replace("'", "");
}

const priorityOverrides = [
	"Categories/SpaceElevator",
	"Categories/ExtractableResources",
	"Categories/Ingots",
	"Categories/Compounds",
	"Categories/StandardParts",
	"Categories/Electronics",
	"Categories/Communications",
	"Categories/OilProducts",
	"Categories/AdvancedRefinement",
	"Categories/Containers",
	"Categories/Packaging",
	"Categories/Unpackaging",
	"Categories/Fuel",
	"Categories/IndustrialParts",
	"Categories/Nuclear",
	"Categories/QuantumTechnology",
	"Categories/Biomass",
	"Categories/AlienRemains",
	"Categories/PowerShards",
	"Categories/RawMaterials",
	"Categories/Tools",
	"Categories/Weapon",
	"Categories/Ammunition",
	"Categories/BodyEquipment",
	"Categories/Consumables",
	"Categories/FICSMAS",
];

async function main() {
	const [major, minor, patch] = process.versions.node.split('.').map(Number);
	if (major < 18 || (major === 18 && minor < 17)) {
		console.error("This script requires Node.js version 18.17.0 or higher.");
		process.exit(1);
	}

	const args = argsParser(process.argv);
	const extractedFilesPath = args["extracted-files"];
	const tsSavePath = args["ts-save"];
	if (!extractedFilesPath) {
		throw new Error("Please provide the path to the extracted files FactoryGame\\Content\\ folder using --extracted-files=<path>.");
	}
	if (!tsSavePath) {
		throw new Error("Please provide the path to save the TypeScript file using --ts-save=<path>.");
	}

	const translations: Record<string, string> = {};
	for (const file of readdirSync(extractedFilesPath, { recursive: true, withFileTypes: true })) {
		if (file.name !== "AllStringTables.json" && !file.parentPath.includes("en-US")) {
			continue;
		}
		const filePath = join(file.parentPath, file.name);
		const fileContent = readFileSync(filePath, "utf-8");
		const jsonData = JSON.parse(fileContent);
		for (const group of Object.values(jsonData)) {
			for (const [key, value] of Object.entries(group as any)) {
				if (typeof value !== "string") {
					continue;
				}
				translations[key] = value as string;
			}
		}
	}


	const partToCategoryKey: Record<string, string> = {};
	const catFileToDisplayNameMap: Record<string, {key: string, priority: number}> = {};
	for (const file of readdirSync(extractedFilesPath, { recursive: true, withFileTypes: true })) {
		if (!file.isFile()) {
			continue;
		}
		if (!file.name.endsWith(".json")) {
			continue;
		}
		const filePath = join(file.parentPath, file.name);
		const fileContent = readFileSync(filePath, "utf-8");
		if (!fileContent.includes(`"mCategory": `) && !fileContent.includes(`"mOverriddenCategory": `)) {
			continue;
		}
		const jsonData = JSON.parse(fileContent);
		if (!Array.isArray(jsonData)) {
			throw new Error(`Expected an array in file: ${filePath}`);
		}

		for (const item of jsonData) {
			const type = item["Type"];
			// let objectPath: string | undefined;
			// if (item.Properties?.mCategory) {
			// 	objectPath = item.Properties.mCategory.ObjectPath;
			// } else if (item.Properties?.mOverriddenCategory) {
			// 	objectPath = item.Properties.mOverriddenCategory.ObjectPath;
			// }
			let objectPath = (
				item.Properties?.mCategory?.ObjectPath ||
				item.Properties?.mOverriddenCategory?.ObjectPath
			);
			if (!objectPath) {
				continue;
			}
			objectPath = objectPath
				.replace(/^\/Game\//, "")
				.replace(/\.[\d]$/, ".json");
			objectPath = join(extractedFilesPath, ...objectPath.split("/"));
			
			let catDisplayName: string = "";
			let priority: number = 0;
			if (catFileToDisplayNameMap[objectPath]) {
				catDisplayName = catFileToDisplayNameMap[objectPath].key;
				priority = catFileToDisplayNameMap[objectPath].priority;
			}
			else {
				if (!existsSync(objectPath)) {
					console.warn(`File not found: ${objectPath}`);
					continue;
				}
				const catFileContent = readFileSync(objectPath, "utf-8");
				const catJsonData = JSON.parse(catFileContent);
				for (const catItem of catJsonData) {
					if (!catItem.Properties?.mDisplayName?.Key) {
						continue;
					}
					catDisplayName = catItem.Properties.mDisplayName.Key;
					if (priorityOverrides.includes(catDisplayName)) {
						priority = priorityOverrides.indexOf(catDisplayName) + 1;
					}
					else {
						priority = catItem.Properties.mMenuPriority || 99;
					}
				}
				if (!catDisplayName) {
					console.warn(`No display name found in file: ${objectPath}`);
					continue;
				}
				catFileToDisplayNameMap[objectPath] = {
					key: catDisplayName,
					priority: priority || 0
				};
			}

			partToCategoryKey[type] = catDisplayName;
		}
	}

	const categoryKeyToDetails: Record<string, {displayName: string, priority: number}> = {};
	for (const {key, priority} of Object.values(catFileToDisplayNameMap)) {
		const displayName = translations[key] || key;
		categoryKeyToDetails[key] = { displayName, priority };
	}

	const sortedCategoryKeyToDetails = Object.fromEntries(
		Object.entries(categoryKeyToDetails).sort(([_, a], [__, b]) => {
			// first compare by priority
			if (a.priority !== b.priority) {
				return a.priority - b.priority;
			}
			// then compare by display name
			return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
		})
	);

	const outputData = {
		partCategories: partToCategoryKey,
		categoryDetails: sortedCategoryKeyToDetails
	};
	const outputJson = JSON.stringify(outputData, null, "\t");
	const outputTs = 
		`// Auto-generated by GameJsonDumpProcessor.ts\n` +
		`export const gameCategories: {partCategories: Record<string, string>, categoryDetails: Record<string, {displayName: string, priority: number}>} = ${outputJson};\n`;
	writeFileSync(tsSavePath, outputTs, "utf-8");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
