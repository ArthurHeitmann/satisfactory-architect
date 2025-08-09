import { gridSize } from "./constants";

export class GraphView {
	readonly offset: IVector2D;
	scale: number;
	enableGridSnap: boolean;
	gridSnap: number;

	constructor(offset: IVector2D, scale: number, enableGridSnap: boolean) {
		this.offset = $state(offset);
		this.scale = $state(scale);
		this.enableGridSnap = $state(enableGridSnap);
		this.gridSnap = $derived(this.enableGridSnap ? gridSize / 2 : 0);
	}

	static newDefault(): GraphView {
		return new GraphView({ x: 0, y: 0 }, 1, true);
	}

	static fromJSON(json: any): GraphView {
		return new GraphView(json.offset, json.scale, json.enableGridSnap);
	}

	toJSON(): any {
		return {
			offset: $state.snapshot(this.offset),
			scale: this.scale,
			enableGridSnap: this.enableGridSnap,
		};
	}
}

export interface IVector2D {
	x: number;
	y: number;
}

export class Vector2D {
	x: number;
	y: number;

	constructor(vector: IVector2D) {
		this.x = $state(vector.x);
		this.y = $state(vector.y);
	}

	static fromJSON(json: IVector2D): Vector2D {
		return new Vector2D(json);
	}

	applyJson(json: IVector2D): void {
		this.x = json.x;
		this.y = json.y;
	}

	toJSON(): IVector2D {
		return {
			x: this.x,
			y: this.y,
		};
	}
}