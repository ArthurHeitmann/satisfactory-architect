import { browser } from "$app/environment";
import { writable, type Writable } from "svelte/store";

const storage: any = browser ? localStorage : {};



export function loadFormLocalStorage<T>(key: string, defaultValue: T) {
	try {
		const prefs = storage["preferences"] || "{}";
		const stored = JSON.parse(prefs)[key];
		if (stored !== undefined) {
			return stored as T;
		}
	} catch (e) {
		console.error(e);
	}
	return defaultValue;
}

export function writeToLocalStorage(key: string, value: any) {
	let prefs: any = {};
	try {
		prefs = JSON.parse(storage["preferences"] || "{}");
	} catch (e) {
		console.error(e);
	}
	prefs[key] = value;
	storage["preferences"] = JSON.stringify(prefs);
}

export function localStorageState<T>(key: string, defaultValue: T): Writable<T> {
	const store = writable<T>(loadFormLocalStorage(key, defaultValue));
	store.subscribe((value) => writeToLocalStorage(key, value));
	return store;
}
