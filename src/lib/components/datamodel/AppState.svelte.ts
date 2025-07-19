import { writeToLocalStorage } from "$lib/localStorageState.svelte";
import { Debouncer } from "$lib/utilties";
import { StorageKeys } from "./constants";
import { GraphPage } from "./GraphPage.svelte";
import { IdGen, type Id } from "./IdGen";

export class AppState {
	readonly idGen: IdGen;
	private currentPageId: Id;
	currentPage: GraphPage;
	pages: GraphPage[];
	private debouncedSave: Debouncer<(json: any) => void>;

	constructor(idGen: IdGen, currentPageId: Id, pages: GraphPage[]) {
		this.idGen = idGen;
		this.currentPageId = $state(currentPageId);
		this.pages = $state.raw(pages);
		this.currentPage = $derived(this.pages.find((p) => p.id === this.currentPageId)!);
		
		this.debouncedSave = new Debouncer(this.saveToLocalStorage.bind(this), 1500);
		$effect(() => {
			const json = this.toJSON();
			this.debouncedSave.call(json);
		});
	}

	static newDefault(): AppState {
		const idGen = new IdGen(0);
		const page = GraphPage.newDefault(idGen, "Page 1");
		return new AppState(idGen, page.id, [page]);
	}

	static fromJSON(json: any): AppState {
		const idGen = IdGen.fromJson(json.idGen);
		const pages = json.pages.map((p: any) => GraphPage.fromJSON(idGen, p));
		return new AppState(idGen, json.currentPageId, pages);
	}

	toJSON(): any {
		return {
			idGen: this.idGen.toJSON(),
			currentPageId: this.currentPageId,
			pages: this.pages.map((p) => p.toJSON()),
		};
	}

	addPage(page: GraphPage): void {
		if (this.pages.some((p) => p.id === page.id)) {
			throw new Error(`Page with id ${page.id} already exists.`);
		}
		this.pages.push(page);
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
		writeToLocalStorage(StorageKeys.appState, json)
	}
}
