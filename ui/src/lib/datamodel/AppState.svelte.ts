import { writeToLocalStorage } from "$lib/localStorageState.svelte";
import { Debouncer, deepClone } from "$lib/utilties";
import { dataModelVersion, saveDataType, StorageKeys } from "./constants";
import { trackStateChanges } from "./globals.svelte";
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
		this.idGen = idGen;	// TODO sync
		this.currentPageId = $state(currentPageId);
		this.pages = $state.raw(pages);	// TODO sync
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
		if (json.type !== saveDataType) {
			throw new Error(`Invalid JSON type: ${json.type}. Expected: app-state`);
		}
		this.idGen.replaceFromJson(json.idGen);
		this.currentPageId = json.currentPageId;
		this.pages = json.pages.map((p: any) => GraphPage.fromJSON(this, p));
	}

	insertPagesFromJSON(json: any, pasteSource: PasteSource, index: number|null = null): GraphPage[] {
		if (json.version !== dataModelVersion) {
			throw new Error(`Unsupported data model version: ${json.version}. Expected: ${dataModelVersion}`);
		}
		if (json.type !== saveDataType) {
			throw new Error(`Invalid JSON type: ${json.type}. Expected: app-state`);
		}
		const idMapper = new IdMapper(this.idGen);
		const allJsonNodes = json.pages.flatMap((p: any) => Object.values(p.nodes));
		const allJsonEdges = json.pages.flatMap((p: any) => Object.values(p.edges));
		for (const item of [...json.pages, ...allJsonNodes, ...allJsonEdges]) {
			if ("id" in item) {
				item.id = idMapper.mapId(item.id);
			}
		}
		const newPages = (json.pages as any[]).map((p: any) => GraphPage.fromJSON(this, p));
		for (const page of newPages) {
			this.addPage(page, index);
			page.afterPaste(idMapper, pasteSource);
		}
		return newPages;
	}

	toJSON(options: {forceToJson?: boolean, filterPageIds?: Id[]} = {}): any {
		const state = {
			version: dataModelVersion,
			type: saveDataType,
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

	addPage(page: GraphPage, index: number|null = null): void {
		if (this.pages.some((p) => p.id === page.id)) {
			throw new Error(`Page with id ${page.id} already exists.`);
		}
		if (index !== null) {
			this.pages = [
				...this.pages.slice(0, index),
				page,
				...this.pages.slice(index),
			];
		} else {
			this.pages = [...this.pages, page];
		}
	}

	removePage(pageId: Id): void {
		if (this.pages.length === 1) {
			throw new Error("Cannot remove the last this.");
		}
		const pageIndex = this.pages.findIndex((p) => p.id === pageId);
		if (pageIndex === -1) {
			throw new Error(`Page with id ${pageId} does not exist.`);
		}
		this.pages = this.pages.filter((p) => p.id !== pageId);
		if (this.currentPageId === pageId && this.pages.length > 0) {
			const newIndex = Math.min(pageIndex, this.pages.length - 1);
			this.currentPageId = this.pages[newIndex].id;
		}
	}

	duplicatePage(pageId: Id): void {
		const pageIndex = this.pages.findIndex((p) => p.id === pageId);
		if (pageIndex === -1) {
			throw new Error(`Page with id ${pageId} does not exist.`);
		}
		const json = deepClone(this.toJSON({filterPageIds: [pageId]}));
		const usedNames = this.pages.map((p) => p.name);
		const newPage = this.insertPagesFromJSON(json, "local", pageIndex + 1)[0];
		let newName = newPage.name;
		if (!/ copy( \d+)?$/.test(newName)) {
			newName += " copy";
		}
		let copyIndex = 1;
		while (usedNames.includes(newName)) {
			newName = newName.replace(/ copy( \d+)?$/, ` copy ${copyIndex++}`);
		}
		newPage.name = newName;
	}

	swapPages(fromIndex: number, toIndex: number): void {
		if (fromIndex < 0 || fromIndex >= this.pages.length || toIndex < 0 || toIndex >= this.pages.length) {
			throw new Error(`Invalid indices: fromIndex=${fromIndex}, toIndex=${toIndex}, pages.length=${this.pages.length}`);
		}
		if (fromIndex === toIndex) {
			return;
		}
		
		const newPages = [...this.pages];
		const [movedPage] = newPages.splice(fromIndex, 1);
		newPages.splice(toIndex, 0, movedPage);
		this.pages = newPages;
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
