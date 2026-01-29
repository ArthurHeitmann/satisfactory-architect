import { browser } from "$app/environment";

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

export class LocalStorageState<T> {
	private _value: T = $state()!;
	private key: string;

	constructor(key: string, defaultValue: T) {
		this.key = key;
		this._value = loadFormLocalStorage(key, defaultValue);
	}

	get value(): T {
		return this._value;
	}

	set value(newValue: T) {
		this._value = newValue;
		writeToLocalStorage(this.key, newValue);
	}
}
