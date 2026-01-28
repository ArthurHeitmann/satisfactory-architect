import { untrack } from "svelte";

interface WatchOptions<T> {
	dependencies: () => T;
	onChange: (value: T) => void;
	onInitialize?: (value: T) => void;
	guard?: () => boolean;
}

export function watchState<T>(options: WatchOptions<T>) {
	let hasInitialized = false;

	$effect(() => {
		const value = options.dependencies();
		if (options.guard && !options.guard()) {
			hasInitialized = false;
		} else if (hasInitialized) {
			untrack(() => options.onChange(value));
		} else {
			hasInitialized = true;
			if (options.onInitialize) {
				untrack(() => options.onInitialize!(value));
			}
		}
	});
}
