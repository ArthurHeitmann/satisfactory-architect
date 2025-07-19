import { readFileSync, readdirSync, copyFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import argsParser from "args-parser";
import { parseUeData } from "./ue_data_parser";
import { SFBuilding, SFIcon, SFPart, SFProductionBuilding, SFRecipe, SFRecipePart, SatisfactoryDatabase } from "../src/lib/satisfactoryDatabaseTypes";
import { gameCategories } from "./categories";

function parseFullName(fullName: string): string {
	const name = fullName.split(".").at(-1);
	if (!name) {
		throw new Error(`Invalid full name: ${fullName}`);
	}
	return name.replace("'", "");
}

function parseRecipePartList(listString: string, duration: number): SFRecipePart[] {
	const list = parseUeData(listString) as any[];
	return list.map((item: any) => {
		let amount = item.Amount as number;
		if (amount >= 1000) {
			amount = Math.round(amount / 1000);
		}
		return {
			itemClass: parseFullName(item.ItemClass as string),
			amountPerMinute: amount * 60 / duration,
		};
	});
}

function splitIconName(icon: string): { iconName: string, resolution: number } | null {
	const nameParts = icon.match(/^(.*)_(\d+)(?:_[^\d]+)?$/);
	if (!nameParts) {
		return null;
	}
	const iconName = nameParts[1];
	const resolution = Number(nameParts[2]);
	if (isNaN(resolution) || resolution <= 0) {
		return null;
	}
	return { iconName, resolution };
}

async function main() {
	const [major, minor, patch] = process.versions.node.split('.').map(Number);
	if (major < 18 || (major === 18 && minor < 17)) {
		console.error("This script requires Node.js version 18.17.0 or higher.");
		process.exit(1);
	}

	// const jsonPath = process.argv[2];
	// const extractedFilesPath = process.argv[3];
	// const imgSavePath = process.argv[4];
	const args = argsParser(process.argv);
	const jsonPath = args["json"];
	const extractedFilesPath = args["extracted-files"];
	const imgSavePath = args["img-save"];
	const tsSavePath = args["ts-save"];
	if (!jsonPath) {
		throw new Error("Please provide the path to the JSON file using --json=<path>.");
	}
	if (!tsSavePath) {
		throw new Error("Please provide the path to save the JSON file using --json-save=<path>.");
	}
	
	let content = readFileSync(jsonPath, "utf-16le");
	content = content.slice(content.indexOf("["));
	const jsonData = JSON.parse(content);

	const recipes = new Map<string, SFRecipe>();
	const referencedParts = new Set<string>();
	const referencedBuildings = new Set<string>();
	const referencedCategories = new Set<string>();
	// recipes
	for (const classDefs of jsonData) {
		for (const classDef of classDefs["Classes"]) {
			const className = classDef["ClassName"];
			if (!className.startsWith("Recipe_")) {
				continue;
			}
			if (!classDef["mProducedIn"] || !classDef["mIngredients"] || !classDef["mProduct"] || !classDef["mManufactoringDuration"]) {
				continue;
			}
			let allProducedIn = parseUeData(classDef["mProducedIn"]) as string[];
			allProducedIn = allProducedIn.filter((item: string) => !item.includes("BuildGun"));
			let producedIn =
				allProducedIn.find((item: string) => item.startsWith("/Game/FactoryGame/Buildable/Factory")) /*??
				allProducedIn.find((item: string) => item.startsWith("/Game/FactoryGame/Buildable/-Shared/WorkBench")) ??
				allProducedIn[0]*/;
			if (!producedIn) {
				continue;
			}
			producedIn = parseFullName(producedIn);
			if (producedIn === "BP_WorkshopComponent_C") {
				producedIn = "Build_Workshop_C";
			}
			const duration = Number(classDef["mManufactoringDuration"]);
			const outputs = parseRecipePartList(classDef["mProduct"] as string, duration);
			const recipe: SFRecipe = {
				className: className,
				recipeDisplayName: parseFullName(classDef["mDisplayName"]),
				inputs: parseRecipePartList(classDef["mIngredients"] as string, duration),
				outputs: outputs,
				producedIn: producedIn,
				category: gameCategories.partCategories[outputs[0].itemClass] || "",
				priority: Number(classDef["mManufacturingMenuPriority"]) || 0,
			};
			if (!recipe.category) {
				if (className.includes("Nobelisk")) {
					recipe.category = "Categories/Ammunition";
				}
				else if (["Shroom", "Nut", "Berry"].some((name) => recipe.className.includes(name))) {
					recipe.category = "Categories/Equipment";
				}
			}
			recipes.set(recipe.className, recipe);
			
			for (const part of [...recipe.inputs, ...recipe.outputs]) {
				referencedParts.add(part.itemClass);
			}

			referencedBuildings.add(producedIn);
			referencedBuildings.add(producedIn.replace(/^Build_/, "Desc_"));
			referencedCategories.add(recipe.category);
		}
	}
	// resource extractors
	const visitedResources = new Set<string>();
	const productionBuildings = new Map<string, SFProductionBuilding>();
	for (const classDefs of jsonData) {
		for (const classDef of classDefs["Classes"]) {
			const className = classDef["ClassName"];
			if (!("mAllowedResources" in classDef)) {
				continue;
			}
			const resources: string[] = [];
			if (classDef.mAllowedResources) {
				const allowedResources = (parseUeData(classDef["mAllowedResources"]) as string[]).map(parseFullName);
				resources.push(...allowedResources);
			}
			if (classDef.mParticleMap) {
				const particleMap = parseUeData(classDef["mParticleMap"]) as Record<string, string>[];
				for (const entry of particleMap) {
					for (const [key, value] of Object.entries(entry)) {
						if (!key.includes("ResourceNode")) {
							continue;
						}
						const resourceName = parseFullName(value);
						resources.push(resourceName);
					}
				}
			}
			let productionRate = Number(classDef["mItemsPerCycle"]) / Number(classDef["mExtractCycleTime"]);
			if (!productionRate) {
				continue;
			}
			if (productionRate >= 1000) {
				productionRate = Math.round(productionRate / 1000);
			}
			productionRate *= 60;

			productionBuildings.set(className, {
				buildingClassName: className,
				baseProductionRate: productionRate,
				outputs: resources,
			});
			for (const resource of resources) {
				visitedResources.add(resource);
				referencedParts.add(resource);
				referencedBuildings.add(className);
			}
		}
	}

	console.log(`Found ${recipes.size} recipes.`);
	console.log(`Found ${referencedParts.size} unique parts in recipes.`);

	const parts = new Map<string, SFPart>();
	const usedIcons = new Set<string>();
	// parts
	for (const classDefs of jsonData) {
		for (const classDef of classDefs["Classes"]) {
			const className = classDef["ClassName"];
			if (!className.startsWith("Desc_") && !className.startsWith("BP_")) {
				continue;
			}
			if (!referencedParts.has(className)) {
				continue;
			}
			let icon = parseFullName(classDef["mPersistentBigIcon"] as string);
			const part: SFPart = {
				className: className,
				displayName: classDef["mDisplayName"],
				form: classDef["mForm"] as string,
				icon: splitIconName(icon)?.iconName ?? "",
				fluidColor: classDef["mFluidColor"] as string,
				category: gameCategories.partCategories[className] || "",
			};
			if (!part.category) {
				if (className.includes("Nobelisk")) {
					part.category = "Categories/Ammunition";
				}
				else if (["Shroom", "Nut", "Berry"].some((name) => part.className.includes(name))) {
					part.category = "Categories/Equipment";
				}
			}
			usedIcons.add(icon);
			parts.set(part.className, part);
		}
	}

	const buildings = new Map<string, SFBuilding>();
	// buildings
	for (const classDefs of jsonData) {
		for (const classDef of classDefs["Classes"]) {
			let className = classDef["ClassName"].replace(/^Desc_/, "Build_");
			if (className.startsWith("Recipe_")) {
				const newClassName = className.replace(/^Recipe_/, "Build_");
				if (referencedBuildings.has(newClassName)) {
					className = newClassName;
				}
			}
			if (!className.startsWith("Build_")) {
				continue;
			}
			if (!referencedBuildings.has(className)) {
				continue;
			}
			const building = buildings.get(className) ?? {
				className: className,
				displayName: "",
				icon: "",
			};
			if (!building.displayName && classDef["mDisplayName"]) {
				building.displayName = classDef["mDisplayName"];
			}
			if (!building.icon && classDef["mPersistentBigIcon"]) {
				const icon = parseFullName(classDef["mPersistentBigIcon"] as string);
				building.icon = splitIconName(icon)?.iconName ?? "";
				usedIcons.add(icon);
				usedIcons.add(icon);
			}
			buildings.set(building.className, building);
		}
	}
	const referencedBuildBuildings = Array.from(referencedBuildings.values()).filter((building) => building.startsWith("Build_"));
	console.log(`Found ${buildings.size}/${referencedBuildBuildings.length} buildings.`);

	const categories: Record<string, string> = {};
	for (const categoryKey of referencedCategories) {
		const category = gameCategories.categoryDetails[categoryKey];
		categories[categoryKey] = category?.displayName || categoryKey;
	}
	categories["Categories/ExtractableResources"] = "Extractable Resources";
	
	const icons = new Map<string, SFIcon>();
	// icons
	if (extractedFilesPath && imgSavePath) {
		const imgPaths = new Map<string, string>();
		for (const file of readdirSync(extractedFilesPath, { recursive: true, withFileTypes: true })) {
			if (!file.isFile()) {
				continue;
			}
			const filePath = join(file.parentPath, file.name);
			const imgName = basename(filePath).split(".")[0];
			if (!usedIcons.has(imgName)) {
				continue;
			}
			imgPaths.set(imgName, filePath);
		}
		console.log(`Found ${imgPaths.size}/${usedIcons.size} used icons in extracted files.`);

		for (const [icon, filePath] of imgPaths) {
			const { iconName, resolution } = splitIconName(icon) || {};
			if (!iconName || !resolution) {
				console.warn(`Invalid icon name format: ${icon}`);
				continue;
			}
			icons.set(iconName, {
				name: iconName,
				resolutions: [resolution, 48],
			});
			const destPath = join(imgSavePath, `${iconName}.png`);
			// copyFileSync(filePath, destPath);
		}
		console.log(`Copied ${imgPaths.size} icons to ${imgSavePath}.`);
	}

	const recipeGroups: Record<string, SFRecipe[]> = {};
	for (const recipe of recipes.values()) {
		const outputDisplayName = parts.get(recipe.outputs[0].itemClass)!.displayName;
		if (!recipeGroups[outputDisplayName]) {
			recipeGroups[outputDisplayName] = [];
		}
		recipeGroups[outputDisplayName].push(recipe);
	}
	const sortedRecipeGroups = Object.entries(recipeGroups).sort((a, b) => {
		const aCat = gameCategories.categoryDetails[a[1][0].category];
		const bCat = gameCategories.categoryDetails[b[1][0].category];
		if (aCat?.priority !== bCat?.priority) {
			return (aCat?.priority ?? 99) - (bCat?.priority ?? 99);
		}
		if (aCat?.displayName !== bCat?.displayName) {
			return (aCat?.displayName ?? "").localeCompare(bCat?.displayName ?? "") || 0;
		}
		return a[0].localeCompare(b[0]);
	});
	for (const group of Object.values(recipeGroups)) {
		group.sort((a, b) => {
			const aIsAlt = a.recipeDisplayName.startsWith("Alternate:");
			const bIsAlt = b.recipeDisplayName.startsWith("Alternate:");
			if (aIsAlt && !bIsAlt) {
				return 1;
			} else if (!aIsAlt && bIsAlt) {
				return -1;
			}
			return a.recipeDisplayName.localeCompare(b.recipeDisplayName);
		});
	}
	const sortedRecipes = sortedRecipeGroups.flatMap(([_, recipes]) => recipes);
	const sortedParts = Array.from(parts.values()).sort((a, b) => {
		const aCat = gameCategories.categoryDetails[a.category];
		const bCat = gameCategories.categoryDetails[b.category];
		if (aCat?.priority !== bCat?.priority) {
			return (aCat?.priority ?? 99) - (bCat?.priority ?? 99);
		}
		if (aCat?.displayName !== bCat?.displayName) {
			return (aCat?.displayName ?? "").localeCompare(bCat?.displayName ?? "") || 0;
		}
		return a.displayName.localeCompare(b.displayName) || 0;
	});
	const sortedProductionBuildings = Array.from(productionBuildings.entries()).sort((a, b) => {
		const aDisplayName = buildings.get(a[0])?.displayName || a[0];
		const bDisplayName = buildings.get(b[0])?.displayName || b[0];
		return aDisplayName.localeCompare(bDisplayName) || 0;
	});
	const sortedCategories = Array.from(Object.entries(categories)).sort((a, b) => {
		const aCat = gameCategories.categoryDetails[a[0]];
		const bCat = gameCategories.categoryDetails[b[0]];
		if (aCat?.priority !== bCat?.priority) {
			return (aCat?.priority ?? 99) - (bCat?.priority ?? 99);
		}
		return (aCat?.displayName ?? "").localeCompare(bCat?.displayName ?? "") || 0;
	});

	const outputData: SatisfactoryDatabase = {
		recipes: Object.fromEntries(sortedRecipes.map((recipe) => [recipe.className, recipe])),
		parts: Object.fromEntries(sortedParts.map((part) => [part.className, part])),
		productionBuildings: Object.fromEntries(sortedProductionBuildings.map(([className, building]) => [className, building])),
		buildings: Object.fromEntries(buildings.entries()),
		categories: Object.fromEntries(sortedCategories),
		icons: Object.fromEntries(icons.entries()),
	};
	const outputJson = JSON.stringify(outputData, null, "\t");
	const imports = `import type { SatisfactoryDatabase } from "./satisfactoryDatabaseTypes";`;
	let outputTs = 
		`// Auto-generated by DocsJsonProcessor.ts\n` +
		`${imports}\n\n` +
		`export const satisfactoryDatabase: SatisfactoryDatabase = ${outputJson};\n`;
	outputTs = outputTs.replace(/^(\t+)*"(\w+?)":/gm, `$1$2:`);

	writeFileSync(tsSavePath, outputTs, "utf-8");
	console.log(`Saved TypeScript data to ${tsSavePath}.`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
