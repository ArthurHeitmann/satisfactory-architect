import { assertUnreachable } from "$lib/utilties";
import type { LayoutOrientation, GraphNode } from "./GraphNode.svelte";
import type { GraphPage, PageContext } from "./GraphPage.svelte";
import type { IVector2D } from "./GraphView.svelte";
import type { Id, IdMapper } from "./IdGen";
import { edgeArrowLength } from "./constants";
import { canUseInvertedEdgeControlPoint, getNodeRadius } from "./nodeTypeProperties.svelte";
import { applyJsonToObject, type JsonSerializable } from "./StateHistory.svelte";
import { determineStraightEdgeCount, makeStraightEdgePoints } from "./straightEdgeRouting";

export type GraphEdgeType = "item-flow";

export type GraphEdgeDisplayType = "straight" | "curved" | "angled" | "teleport";
export interface GraphEdgeProperties {
	displayType: GraphEdgeDisplayType;
	straightLineOffsets?: number[];
	startOrientation: LayoutOrientation|null;
	endOrientation: LayoutOrientation|null;
	isDrainLine: boolean;
}

export class GraphEdge implements JsonSerializable<PageContext> {
	readonly context: PageContext;
	readonly id: Id;
	type: GraphEdgeType;
	private _startNodeId: Id;
	private _endNodeId: Id;
	get startNodeId(): Id { return this._startNodeId; }
	get endNodeId(): Id { return this._endNodeId; }
	readonly properties: GraphEdgeProperties;
	pushThroughput: number;
	pullThroughput: number;
	readonly asJson: any;

	readonly startNode: GraphNode|undefined;
	readonly endNode: GraphNode|undefined;
	readonly startNodePosition: IVector2D|undefined;
	readonly endNodePosition: IVector2D|undefined;
	readonly deltaVector: IVector2D|undefined;
	readonly unitVector: IVector2D|undefined;
	readonly length: number;
	readonly startNodeRadius: number;
	readonly endNodeRadius: number;
	readonly controlPointLength: number;
	readonly orientationVectors: {
		startOffset: IVector2D;
		endOffset: IVector2D;
	}|undefined;
	readonly pathPoints: {
		startPoint: IVector2D;
		endPoint: IVector2D;
		endPointWithoutArrow: IVector2D;
		startControlPointVector: IVector2D;
		endControlPointVector: IVector2D;
	}|undefined;
	readonly straightEdgeCount: number|null;
	readonly straightEdgePoints: IVector2D[]|null;

	constructor(context: PageContext, id: Id, type: GraphEdgeType, startNodeId: Id, endNodeId: Id, properties: GraphEdgeProperties) {
		this.context = context;
		this.id = id;
		this.type = $state(type);
		this._startNodeId = $state(startNodeId);
		this._endNodeId = $state(endNodeId);
		this.properties = $state(properties);
		this.pushThroughput = $state(0);
		this.pullThroughput = $state(0);
		this.asJson = $derived(this.toJSON());
		
		this.startNode = $derived(this.context.page.nodes.get(this.startNodeId));
		this.endNode = $derived(this.context.page.nodes.get(this.endNodeId));
		this.startNodePosition = $derived(this.startNode?.getAbsolutePosition(this.context.page));
		this.endNodePosition = $derived(this.endNode?.getAbsolutePosition(this.context.page));
		this.deltaVector = $derived.by(() => {
			if (!this.startNodePosition || !this.endNodePosition) {
				return undefined;
			}
			return {
				x: this.endNodePosition.x - this.startNodePosition.x,
				y: this.endNodePosition.y - this.startNodePosition.y,
			};
		});
		this.unitVector = $derived.by(() => {
			const delta = this.deltaVector;
			if (!delta) {
				return undefined;
			}
			const length = Math.sqrt(delta.x * delta.x + delta.y * delta.y);
			if (length === 0) {
				return { x: 0, y: 0 };
			}
			return { x: delta.x / length, y: delta.y / length };
		});
		this.length = $derived.by(() => {
			const delta = this.deltaVector;
			if (!delta) {
				return 0;
			}
			return Math.sqrt(delta.x * delta.x + delta.y * delta.y);
		});
		this.startNodeRadius = $derived.by(() => {
			return this.startNode ? getNodeRadius(this.startNode) : 0;
		});
		this.endNodeRadius = $derived.by(() => {
			return this.endNode ? getNodeRadius(this.endNode) : 0;
		});
		this.controlPointLength = $derived.by(() => {
			const delta = this.deltaVector;
			const length = this.length;
			if (!delta || !length) {
				return 1;
			}
			const factor = length / 4;
			const minConstraint = Math.min(Math.abs(delta.x), Math.abs(delta.y)) / 2;
			return Math.max(Math.min(factor, minConstraint), 1);
		});

		this.orientationVectors = $derived.by(() => {
			const orientationToCtrlPoint = {
				"top": { x: 0, y: -1 },
				"bottom": { x: 0, y: 1 },
				"left": { x: -1, y: 0 },
				"right": { x: 1, y: 0 },
			};
			const getOrientationFromDirection = (delta: IVector2D, flipDirection: boolean): keyof typeof orientationToCtrlPoint => {
				const xIsDominant = Math.abs(delta.x) > Math.abs(delta.y);
				if (xIsDominant) {
					const xIsPositive = delta.x >= 0;
					if (xIsPositive !== flipDirection) {
						return "right";
					} else {
						return "left";
					}
				} else {
					const yIsPositive = delta.y >= 0;
					if (yIsPositive !== flipDirection) {
						return "bottom";
					} else {
						return "top";
					}
				}
			}
			const startNode = this.startNode;
			const endNode = this.endNode;
			const delta = this.deltaVector;

			let startOffset = { x: 0, y: 0 };
			let endOffset = { x: 0, y: 0 };

			if (!startNode || !endNode || !delta) {
				return undefined;
			}

			if (startNode.properties.type === "resource-joint") {
				const layoutOrientation = startNode.properties.layoutOrientation;
				if (layoutOrientation && orientationToCtrlPoint[layoutOrientation]) {
					startOffset = orientationToCtrlPoint[layoutOrientation];
				}
			}
			if (endNode.properties.type === "resource-joint") {
				const layoutOrientation = endNode.properties.layoutOrientation;
				if (layoutOrientation && orientationToCtrlPoint[layoutOrientation]) {
					endOffset = orientationToCtrlPoint[layoutOrientation];
				}
			}

			let hasStartOffset = startOffset.x !== 0 || startOffset.y !== 0;
			let hasEndOffset = endOffset.x !== 0 || endOffset.y !== 0;

			if (!hasStartOffset && hasEndOffset && canUseInvertedEdgeControlPoint(endNode)) {
				startOffset = { x: -endOffset.x, y: -endOffset.y };
			} else if (hasStartOffset && !hasEndOffset && canUseInvertedEdgeControlPoint(startNode)) {
				endOffset = { x: -startOffset.x, y: -startOffset.y };
			}

			hasStartOffset = startOffset.x !== 0 || startOffset.y !== 0;
			hasEndOffset = endOffset.x !== 0 || endOffset.y !== 0;

			if (!hasStartOffset && this.properties.startOrientation) {
				startOffset = orientationToCtrlPoint[this.properties.startOrientation];
			}
			if (!hasEndOffset && this.properties.endOrientation) {
				endOffset = orientationToCtrlPoint[this.properties.endOrientation];
			}

			hasStartOffset = startOffset.x !== 0 || startOffset.y !== 0;
			hasEndOffset = endOffset.x !== 0 || endOffset.y !== 0;

			if (!hasStartOffset) {
				const orientation = getOrientationFromDirection(delta, false);
				startOffset = orientationToCtrlPoint[orientation];
			}
			if (!hasEndOffset) {
				const orientation = getOrientationFromDirection(delta, true);
				endOffset = orientationToCtrlPoint[orientation];
			}

			return { startOffset, endOffset };
		});

		this.pathPoints = $derived.by(() => {
			const startPos = this.startNodePosition;
			const endPos = this.endNodePosition;

			if (!startPos || !endPos) {
				return undefined;
			}

			let startPoint = { ...startPos };
			let endPoint = { ...endPos };
			let endPointWithoutArrow = { ...endPos };
			let startControlPointVector = { x: 0, y: 0 };
			let endControlPointVector = { x: 0, y: 0 };

			const startNodeRadius = this.startNodeRadius!;
			const endNodeRadius = this.endNodeRadius!;
			if (this.properties.displayType === "straight") {
				const unitVector = this.unitVector!;
				startPoint = {
					x: startPos.x + unitVector.x * startNodeRadius,
					y: startPos.y + unitVector.y * startNodeRadius,
				};
				endPoint = {
					x: endPos.x - unitVector.x * endNodeRadius,
					y: endPos.y - unitVector.y * endNodeRadius,
				};
				endPointWithoutArrow = {
					x: endPos.x - unitVector.x * (endNodeRadius + edgeArrowLength),
					y: endPos.y - unitVector.y * (endNodeRadius + edgeArrowLength),
				};
			} else if (this.properties.displayType === "curved" || this.properties.displayType === "angled" || this.properties.displayType === "teleport") {
				const { startOffset, endOffset } = this.orientationVectors!;
				const startNodeRadius = this.startNodeRadius!;
				const endNodeRadius = this.endNodeRadius!;
				
				startPoint = {
					x: startPos.x + startOffset.x * startNodeRadius,
					y: startPos.y + startOffset.y * startNodeRadius,
				};
				endPoint = {
					x: endPos.x + endOffset.x * endNodeRadius,
					y: endPos.y + endOffset.y * endNodeRadius,
				};
				endPointWithoutArrow = {
					x: endPoint.x + endOffset.x * edgeArrowLength,
					y: endPoint.y + endOffset.y * edgeArrowLength,
				};
				if (this.properties.displayType === "curved") {
					const ctrlPointLength = this.controlPointLength!;
					startControlPointVector = {
						x: startOffset.x * (startNodeRadius + ctrlPointLength),
						y: startOffset.y * (startNodeRadius + ctrlPointLength),
					};
					endControlPointVector = {
						x: endOffset.x * (endNodeRadius + ctrlPointLength + edgeArrowLength),
						y: endOffset.y * (endNodeRadius + ctrlPointLength + edgeArrowLength),
					};
				}
			} else {
				assertUnreachable(this.properties.displayType);
			}

			return { startPoint, endPoint, endPointWithoutArrow, startControlPointVector, endControlPointVector };
		});

		this.straightEdgeCount = $derived.by(() => {
			if (this.properties.displayType !== "angled") {
				return null;
			}
			if (!this.pathPoints || !this.orientationVectors) {
				return null;
			}
			const { startPoint, endPoint } = this.pathPoints;
			const { startOffset, endOffset } = this.orientationVectors;
			return determineStraightEdgeCount(startPoint, endPoint, startOffset, endOffset);
		});
		this.straightEdgePoints = $derived.by(() => {
			if (this.straightEdgeCount === null) {
				return null;
			}
			if (!this.pathPoints || !this.orientationVectors) {
				return null;
			}
			const { startPoint, endPoint } = this.pathPoints;
			const { startOffset, endOffset } = this.orientationVectors;
			let offsets = this.properties.straightLineOffsets;
			if (!offsets || offsets.length + 2 !== this.straightEdgeCount) {
				offsets = Array(Math.max(0, this.straightEdgeCount - 2)).fill(0);
			}
			return makeStraightEdgePoints(startPoint, endPoint, startOffset, endOffset, this.straightEdgeCount, offsets);
		});
	}

	static fromJSON(json: any, context: PageContext): GraphEdge {
		return new GraphEdge(context, json.id, json.type, json.startNodeId, json.endNodeId, json.properties);
	}

	applyJson(json: any): void {
		this.type = json.type;
		this._startNodeId = json.startNodeId;
		this._endNodeId = json.endNodeId;
		applyJsonToObject(json.properties, this.properties as Record<string, any>);
	}

	private toJSON(): any {
		return {
			id: this.id,
			type: this.type,
			startNodeId: this._startNodeId,
			endNodeId: this._endNodeId,
			properties: $state.snapshot(this.properties),
		};
	}

	afterPaste(mapper: IdMapper) {
		this._startNodeId = mapper.mapId(this._startNodeId);
		this._endNodeId = mapper.mapId(this._endNodeId);
	}

	connectNode(node: GraphNode, nodeType: "start" | "end", page: GraphPage): void {
		let oldNodeId: Id;
		if (nodeType === "start") {
			oldNodeId = this._startNodeId;
			this._startNodeId = node.id;
		} else if (nodeType === "end") {
			oldNodeId = this._endNodeId;
			this._endNodeId = node.id;
		} else {
			assertUnreachable(nodeType);
		}
		const oldNode = page.nodes.get(oldNodeId);
		if (oldNode) {
			oldNode.edges.delete(this.id);
		}
		if (!node.edges.has(this.id)) {
			node.edges.add(this.id);
		}
	}
}
