import { assertUnreachable } from "$lib/utilties";
import { gridSize } from "./constants";
import type { GraphEdgeProperties } from "./GraphEdge.svelte";
import type { IVector2D } from "./GraphView.svelte";

function add(vec1: IVector2D, vec2: IVector2D): IVector2D {
	return {
		x: vec1.x + vec2.x,
		y: vec1.y + vec2.y,
	};
}

function sub(vec1: IVector2D, vec2: IVector2D): IVector2D {
	return {
		x: vec1.x - vec2.x,
		y: vec1.y - vec2.y,
	};
}

function mul(vec: IVector2D, num: number): IVector2D {
	return {
		x: vec.x * num,
		y: vec.y * num,
	};
}

function eq(vec1: IVector2D, vec2: IVector2D): boolean {
	return vec1.x === vec2.x && vec1.y === vec2.y;
}

function norm(vec: IVector2D): IVector2D {
	return {
		x: Math.sign(vec.x),
		y: Math.sign(vec.y),
	};
}

type Axis = keyof IVector2D;
type AxisType = "prim" | "sec";

function invAxis(axis: Axis): Axis {
	if (axis === "x")
		return "y";
	if (axis === "y")
		return "x";
	assertUnreachable(axis);
}

function axisOf(vec: IVector2D, axis: AxisType, primAxis: Axis) {
	if (axis === "prim") {
		return vec[primAxis];
	} else if (axis === "sec") {
		return vec[invAxis(primAxis)];
	} else {
		assertUnreachable(axis);
	}
}

function withAxisValue(vec: IVector2D, axis: AxisType, primAxis: Axis, value: number): IVector2D {
	if (axis === "prim") {
		return { ...vec, [primAxis]: value };
	} else if (axis === "sec") {
		return { ...vec, [invAxis(primAxis)]: value };
	} else {
		assertUnreachable(axis);
	}
}

export function primSecVec(prim: number, sec: number, primAxis: AxisType) {
	if (primAxis === "prim") {
		return { x: prim, y: sec };
	} else if (primAxis === "sec") {
		return { x: sec, y: prim };
	} else {
		assertUnreachable(primAxis);
	}
}

class Vec2DExt {
	private vec: IVector2D;
	private primAxis: Axis;

	constructor(vec: IVector2D, prim: Axis) {
		this.vec = vec;
		this.primAxis = prim;
	}

	copy(): Vec2DExt {
		return new Vec2DExt({ ...this.vec }, this.primAxis);
	}

	get prim() {
		if (this.primAxis === "x") {
			return this.vec.x;
		} else if (this.primAxis === "y") {
			return this.vec.y;
		} else {
			assertUnreachable(this.primAxis);
		}
	}
	get sec() {
		if (this.primAxis === "x") {
			return this.vec.y;
		} else if (this.primAxis === "y") {
			return this.vec.x;
		} else {
			assertUnreachable(this.primAxis);
		}
	}
	set prim(value: number) {
		if (this.primAxis === "x") {
			this.vec.x = value;
		} else if (this.primAxis === "y") {
			this.vec.y = value;
		} else {
			assertUnreachable(this.primAxis);
		}
	}
	set sec(value: number) {
		if (this.primAxis === "x") {
			this.vec.y = value;
		} else if (this.primAxis === "y") {
			this.vec.x = value;
		} else {
			assertUnreachable(this.primAxis);
		}
	}

	toVec2D(): IVector2D {
		return { x: this.vec.x, y: this.vec.y };
	}
}

export function determineStraightEdgeCount(
	startPosAbs: IVector2D,
	endPosAbs: IVector2D,
	startDir: IVector2D,
	endDir: IVector2D,
): number {
	const startPos: IVector2D = { x: 0, y: 0 };
	const endPos = norm(sub(endPosAbs, startPosAbs));
	const primAxis: Axis = startDir.x != 0 ? "x" : "y";
	if (
		eq(startDir, mul(endDir, -1)) &&
		eq(add(startPos, startDir), endPos)
	) {
		return 1;
	} else if (eq(add(startPos, sub(startDir, endDir)), endPos)) {
		return 2;
	} else if(
		eq(startDir, mul(endDir, -1)) &&
		axisOf(startDir, "prim", primAxis) === axisOf(endPos, "prim", primAxis) &&
		axisOf(endPos, "sec", primAxis) != 0
	) {
		return 3;
	} else if(
		eq(startDir, endDir) &&
		axisOf(endPos, "sec", primAxis) != 0
	) {
		return 3;
	} else if (
		Math.abs(startDir.x) == Math.abs(endDir.y) &&
		Math.abs(startDir.y) == Math.abs(endDir.x)
	) {
		return 4;
	} else {
		return 5;
	}
}

export function updateEdgeOffsets(props: GraphEdgeProperties, edgeCount: number) {
	const expectedLineCount = Math.max(0, edgeCount - 2);
	const actualLineCount = props.straightLineOffsets?.length ?? 0;
	if (actualLineCount === expectedLineCount) {
		return;
	}
	if (props.straightLineOffsets === undefined) {
		props.straightLineOffsets = Array(expectedLineCount).fill(0);
	} else if (actualLineCount > expectedLineCount) {
		props.straightLineOffsets = props.straightLineOffsets.slice(0, expectedLineCount);
	} else if (actualLineCount < expectedLineCount) {
		props.straightLineOffsets = [
			...props.straightLineOffsets,
			...Array(expectedLineCount - actualLineCount).fill(0),
		];
	}
}

const gapSize = gridSize / 2;
export function makeStraightEdgePoints(
	startPos: IVector2D,
	endPos: IVector2D,
	startDir: IVector2D,
	endDir: IVector2D,
	edgeCount: number,
	offsets: number[],
): IVector2D[] {
	const prim: Axis = startDir.x != 0 ? "x" : "y";
	const startPoint = new Vec2DExt(startPos, prim);
	const endPoint = new Vec2DExt(endPos, prim);
	const startDirE = new Vec2DExt(startDir, prim);
	const endDirE = new Vec2DExt(endDir, prim);
	const primDiff = endPoint.prim - startPoint.prim;
	const secDiff = endPoint.sec - startPoint.sec;
	const points: IVector2D[] = [];
	function pushPoint(point: Vec2DExt) {
		points.push(point.toVec2D());
	}

	let p: Vec2DExt;
	switch (edgeCount) {
		case 1:
			// no intermediate points
			break;
		case 2:
			p = startPoint.copy();
			p.prim = endPoint.prim;
			pushPoint(p);
			break;
		case 3:
			p = startPoint.copy();
			if (startDirE.prim === -endDirE.prim)
				p.prim = p.prim + primDiff / 2 + offsets[0];
			else if (Math.sign(startDirE.prim) === Math.sign(primDiff))
				p.prim = endPoint.prim + endDirE.prim * gapSize + offsets[0];
			else
				p.prim = p.prim + startDirE.prim * gapSize + offsets[0];
			pushPoint(p);
			p.sec = endPoint.sec;
			pushPoint(p);
			break;
		case 4:
			p = startPoint.copy();
			p.prim = p.prim + startDirE.prim * gapSize + offsets[0];
			pushPoint(p);
			p.sec = endPoint.sec + endDirE.sec * gapSize + offsets[1];
			pushPoint(p);
			p.prim = endPoint.prim;
			pushPoint(p);
			break;
		case 5:
			p = startPoint.copy();
			p.prim = p.prim + startDirE.prim * gapSize + offsets[0];
			pushPoint(p);
			if (startPoint.sec !== endPoint.sec)
				p.sec = p.sec + secDiff / 2 + offsets[1];
			else
				p.sec = p.sec + gapSize + offsets[1];
			pushPoint(p);
			p.prim = endPoint.prim + endDirE.prim * gapSize + offsets[2];
			pushPoint(p);
			p.sec = endPoint.sec;
			pushPoint(p);
			break;
		default:
			throw new Error(`Unsupported edge count: ${edgeCount}`);
	}

	return points;
}
