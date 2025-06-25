export interface SFRecipePart {
	itemClass: string;
	amountPerMinute: number;
}

export interface SFRecipe {
	className: string;
	recipeDisplayName: string;
	inputs: SFRecipePart[];
	outputs: SFRecipePart[];
	producedIn: string;
	category: string;
	priority: number;
}

export interface SFPart {
	className: string;
	displayName: string;
	form: string;
	icon: string;
	fluidColor: string;
	recipes: string[];
	category: string;
}

export interface SFBuilding {
	className: string;
	displayName: string;
	icon: string;
}

export interface SFIcon {
	name: string;
	resolutions: number[];
}

export interface SatisfactoryDatabase {
	recipes: Record<string, SFRecipe>;
	parts: Record<string, SFPart>;
	buildings: Record<string, SFBuilding>;
	categories: Record<string, string>;
	icons: Record<string, SFIcon>;
}
