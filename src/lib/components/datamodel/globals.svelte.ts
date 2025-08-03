
export const globals = $state({
	mousePosition: {
		x: 0,
		y: 0,
	},
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
