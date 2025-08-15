import { writeToLocalStorage } from "$lib/localStorageState.svelte";
import { Debouncer } from "$lib/utilties";
import { dataModelVersion, StorageKeys } from "./constants";
import { globals, trackStateChanges } from "./globals.svelte";
import { GraphPage } from "./GraphPage.svelte";
import { IdGen, IdMapper, type Id, type PasteSource } from "./IdGen";

export class AppState {
	readonly idGen: IdGen;
	private currentPageId: Id;
	readonly currentPage: GraphPage;
	pages: GraphPage[];
	private debouncedSave: Debouncer<(json: any) => void>;
	readonly asJson: any;

	constructor(idGen: IdGen, currentPageId: Id, pages: GraphPage[]) {
		this.idGen = idGen;
		this.currentPageId = $state(currentPageId);
		this.pages = $state.raw(pages);
		this.currentPage = $derived(this.pages.find((p) => p.id === this.currentPageId)!);
		
		this.debouncedSave = new Debouncer(this.saveToLocalStorage.bind(this), 1500);
		this.asJson = $derived(this.toJSON());

		$effect(() => {
			const json = this.toJSON();
			this.debouncedSave.call(json);
		});
	}

	static newDefault(): AppState {
		const idGen = new IdGen(0);
		const state = new AppState(idGen, "", []);
		const page = GraphPage.newDefault(state, "Page 1");
		state.addPage(page);
		state.setCurrentPage(page);
		return state;
	}

	static fromJSON(json: any): AppState {
		if (json.version !== dataModelVersion) {
			throw new Error(`Unsupported data model version: ${json.version}. Expected: ${dataModelVersion}`);
		}
		const idGen = IdGen.fromJson(json.idGen);
		const state = new AppState(idGen, json.currentPageId, []);
		const pages = json.pages.map((p: any) => GraphPage.fromJSON(state, p));
		for (const page of pages) {
			state.addPage(page);
		}
		return state;
	}

	replaceFromJSON(json: any): void {
		if (json.version !== dataModelVersion) {
			throw new Error(`Unsupported data model version: ${json.version}. Expected: ${dataModelVersion}`);
		}
		if (json.type !== "app-state") {
			throw new Error(`Invalid JSON type: ${json.type}. Expected: app-state`);
		}
		this.idGen.replaceFromJson(json.idGen);
		this.currentPageId = json.currentPageId;
		this.pages = json.pages.map((p: any) => GraphPage.fromJSON(this, p));
		console.log("AppState replaced from JSON");
	}

	insertPagesFromJSON(json: any): void {
		if (json.version !== dataModelVersion) {
			throw new Error(`Unsupported data model version: ${json.version}. Expected: ${dataModelVersion}`);
		}
		if (json.type !== "app-state") {
			throw new Error(`Invalid JSON type: ${json.type}. Expected: app-state`);
		}
		const idMapper = new IdMapper(this.idGen);
		const pasteSource: PasteSource = "external";
		const allJsonNodes = json.pages.flatMap((p: any) => Object.values(p.nodes));
		const allJsonEdges = json.pages.flatMap((p: any) => Object.values(p.edges));
		for (const item of [...json.pages, ...allJsonNodes, ...allJsonEdges]) {
			if ("id" in item) {
				item.id = idMapper.mapId(item.id);
			}
		}
		const newPages = (json.pages as any[]).map((p: any) => GraphPage.fromJSON(this, p));
		for (const page of newPages) {
			this.addPage(page);
			page.afterPaste(idMapper, pasteSource);
		}
	}

	toJSON(options: {forceToJson?: boolean, filterPageIds?: Id[]} = {}): any {
		const state = {
			version: dataModelVersion,
			type: "app-state",
			idGen: this.idGen.toJSON(),
			currentPageId: this.currentPageId,
			pages: this.pages.map((p) => options.forceToJson ? p.toJSON() : p.asJson),
		};
		if (options.filterPageIds) {
			state.pages = state.pages.filter((p: any) => options.filterPageIds!.includes(p.id));
			state.currentPageId = options.filterPageIds[0];
		}
		return state;
	}

	addPage(page: GraphPage): void {
		if (this.pages.some((p) => p.id === page.id)) {
			throw new Error(`Page with id ${page.id} already exists.`);
		}
		this.pages = [...this.pages, page];
	}

	removePage(pageId: Id): void {
		if (this.pages.length === 1) {
			throw new Error("Cannot remove the last this.");
		}
		this.pages = this.pages.filter((p) => p.id !== pageId);
		if (this.currentPageId === pageId && this.pages.length > 0) {
			this.currentPageId = this.pages[0].id;
		}
	}

	setCurrentPage(page: GraphPage): void {
		if (!this.pages.some((p) => p.id === page.id)) {
			throw new Error(`Page with id ${page.id} does not exist.`);
		}
		this.currentPageId = page.id;
	}

	saveToLocalStorage(json: any): void {
		if (trackStateChanges()) {
			writeToLocalStorage(StorageKeys.appState, json)
		}
	}
}
