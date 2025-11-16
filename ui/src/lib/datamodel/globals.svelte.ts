import { localStorageState } from "$lib/localStorageState.svelte";
import { latestAppVersion, StorageKeys } from "./constants";

export const globals = $state({
	mousePosition: {
		x: 0,
		y: 0,
	},
	useAutoRateForFactoryInOutput: false,
	debugShowNodeIds: false,
	debugShowEdgeIds: false,
	debugConsoleLog: false,
});

let stateChangeBlockers = 0;
export function blockStateChanges() {
	stateChangeBlockers++;
}
export function unblockStateChanges() {
	stateChangeBlockers--;
}
export function trackStateChanges(): boolean {
	return stateChangeBlockers === 0;
}

export const darkTheme = localStorageState(StorageKeys.darkTheme, true);
export const appVersion = localStorageState(StorageKeys.appVersion, latestAppVersion);
