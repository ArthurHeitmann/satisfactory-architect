import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import type { SFRecipePart } from "$lib/satisfactoryDatabaseTypes";
import { assertUnreachable, floorToNearest, roundToNearest, ceilToNearest } from "$lib/utilties";
import { SvelteSet } from "svelte/reactivity";
import type { GraphPage, PageContext } from "./GraphPage.svelte";
import { Vector2D, type IVector2D } from "./GraphView.svelte";
import type { Id, IdGen } from "./IdGen";
import { gridSize, NodePriorities, productionNodeIconSize, productionNodeVerticalPadding, productionNodeHorizontalPadding } from "./constants";
import { getNodeRadius, getProductionNodeDisplayName } from "./nodeTypeProperties.svelte";
import { applyJsonToObject, applyJsonToSet, type JsonSerializable } from "./StateHistory.svelte";

export type GraphNodeType = "production" | "resource-joint" | "splitter" | "merger" | "factory-reference";
export interface GraphNodePropertiesBase {
	type: GraphNodeType;
}
export interface ResourceJointInfo {
	id: Id;
	type: "input" | "output";
}
export interface ProductionRecipeDetails {
	type: "recipe";
	recipeClassName: string;
}
export interface ProductionExtractionDetails {
	type: "extraction";
	partClassName: string;
	buildingClassName: string;
	purityModifier?: number;
}
export interface ProductionFactoryInOutDetails {
	type: "factory-input" | "factory-output";
	partClassName: string;
}
export type ProductionDetails = ProductionRecipeDetails | ProductionExtractionDetails | ProductionFactoryInOutDetails;
export interface GraphNodeProductionProperties extends GraphNodePropertiesBase {
	type: "production";
	details: ProductionDetails;
	multiplier: number;
	resourceJoints: ResourceJointInfo[];
}
export type LayoutOrientation = "top" | "bottom" | "left" | "right";
export type JointDragType = "drag-to-connect" | "click-to-connect";
export interface GraphNodeResourceJointProperties extends GraphNodePropertiesBase {
	type: "resource-joint";
	resourceClassName: string;
	jointType: "input" | "output";
	layoutOrientation: LayoutOrientation | undefined;
	locked: boolean;
	jointDragType?: JointDragType;
	dragStartNodeId?: Id;
}
export interface GraphNodeSplitterMergerProperties extends GraphNodePropertiesBase {
	type: "splitter" | "merger";
	resourceClassName: string;
}
export interface GraphNodeFactoryReferenceProperties extends GraphNodePropertiesBase {
	type: "factory-reference";
	factoryId: Id;
}
export type NewNodeDetails = ProductionDetails | GraphNodeSplitterMergerProperties | GraphNodeFactoryReferenceProperties;
export type GraphNodeProperties = GraphNodeProductionProperties | GraphNodeResourceJointProperties | GraphNodeSplitterMergerProperties | GraphNodeFactoryReferenceProperties;
export class GraphNode<T extends GraphNodeProperties = GraphNodeProperties> implements JsonSerializable<PageContext> {
	readonly id: Id;
	readonly position: Vector2D;
	private dragStartPosition: IVector2D;
	readonly priority: number;
	readonly edges: SvelteSet<Id>;
	parentNode: Id|null;
	readonly children: SvelteSet<Id>;
	readonly properties: T;
	readonly size: IVector2D;

	constructor(id: Id, position: IVector2D, priority: number, edges: Id[], parentNode: Id|null, children: Id[], properties: T, size?: IVector2D) {
		this.id = id;
		this.position = new Vector2D(position);
		this.dragStartPosition = { x: 0, y: 0 };
		this.priority = priority;
		this.edges = new SvelteSet(edges);
		this.parentNode = parentNode;
		this.children = new SvelteSet(children);
		this.properties = $state(properties);
		if (!size) {
			const radius = getNodeRadius(this);
			size = {
				x: radius,
				y: radius,
			};
		}
		this.size = size;
	}

	static makeProductionNode(
		idGen: IdGen,
		position: IVector2D,
		edges: Id[],
		details: ProductionDetails,
		multiplier: number = 1,
	): {parent: GraphNode<GraphNodeProductionProperties>, children: GraphNode<GraphNodeResourceJointProperties>[]} {
		let inputs: SFRecipePart[];
		let outputs: SFRecipePart[];
		switch (details.type) {
			case "recipe":
				const recipe = satisfactoryDatabase.recipes[details.recipeClassName];
				if (!recipe) {
					throw new Error(`Recipe with class name ${details.recipeClassName} does not exist.`);
				}
				inputs = recipe.inputs;
				outputs = recipe.outputs;
				break;
			case "factory-input":
			case "factory-output":
				const recipePart = {
					itemClass: details.partClassName,
					amountPerMinute: 60,
				};
				if (details.type === "factory-input") {
					inputs = [recipePart];
					outputs = [];
				} else {
					inputs = [];
					outputs = [recipePart];
				}
				break;
			case "extraction":
				const part = satisfactoryDatabase.parts[details.partClassName];
				if (!part) {
					throw new Error(`Part with class name ${details.partClassName} does not exist.`);
				}
				inputs = [];
				outputs = [ {
					itemClass: details.partClassName,
					amountPerMinute: 60
				} ];
				break;
			default:
				assertUnreachable(details);
		}
		const displayName = getProductionNodeDisplayName(details);
		const nodeSize = GraphNode.calcSize(Math.max(inputs.length, outputs.length), displayName);
		const children: GraphNode<GraphNodeResourceJointProperties>[] = [];
		const resourceJoints: ResourceJointInfo[] = [];
		const inputsGapSize = floorToNearest(nodeSize.y / inputs.length, gridSize);
		const outputsGapSize = floorToNearest(nodeSize.y / outputs.length, gridSize);
		const inputsYStart = -inputsGapSize/2 * (inputs.length - 1)
		const outputsYStart = -outputsGapSize/2 * (outputs.length - 1)
		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];
			const jointNode = new GraphNode(
				idGen.nextId(),
				{x: -nodeSize.x / 2, y: inputsYStart + inputsGapSize * i},
				NodePriorities.RESOURCE_JOINT,
				[],
				null,
				[],
				{
					type: "resource-joint",
					resourceClassName: input.itemClass,
					jointType: "input",
					locked: true,
					layoutOrientation: "left",
				}
			);
			children.push(jointNode);
			resourceJoints.push({ id: jointNode.id, type: "input" });
		}
		for (let i = 0; i < outputs.length; i++) {
			const output = outputs[i];
			const jointNode = new GraphNode(
				idGen.nextId(),
				{x: nodeSize.x / 2, y: outputsYStart + outputsGapSize * i},
				NodePriorities.RESOURCE_JOINT,
				[],
				null,
				[],
				{
					type: "resource-joint",
					resourceClassName: output.itemClass,
					jointType: "output",
					locked: true,
					layoutOrientation: "right",
				}
			);
			children.push(jointNode);
			resourceJoints.push({ id: jointNode.id, type: "output" });
		}
		const properties: GraphNodeProductionProperties = {
			type: "production",
			details,
			multiplier,
			resourceJoints: resourceJoints,
		};
		const parent = new GraphNode(idGen.nextId(), position, NodePriorities.RECIPE, edges, null, [], properties, nodeSize);
		return { parent, children };
	}

	static fromJSON(json: any): GraphNode {
		return new GraphNode(
			json.id,
			{ x: json.position.x, y: json.position.y },
			json.priority,
			json.edges,
			json.parentNode,
			json.children,
			json.properties,
			json.size,
		);
	}

	applyJson(json: any): void {
		this.position.applyJson(json.position);
		applyJsonToSet(json.edges, this.edges);
		this.parentNode = json.parentNode;
		applyJsonToSet(json.children, this.children);
		applyJsonToObject(json.properties, this.properties as Record<string, any>);
	}

	toJSON(): any {
		return {
			id: this.id,
			position: this.position.toJSON(),
			priority: this.priority,
			edges: Array.from(this.edges),
			parentNode: this.parentNode,
			children: Array.from(this.children),
			properties: $state.snapshot(this.properties),
			size: this.size,
		};
	}

	onDragStart(): void {
		this.dragStartPosition = { x: this.position.x, y: this.position.y };
	}

	move(totalDeltaX: number, totalDeltaY: number, gridSnap: number): void {
		this.position.x = roundToNearest(this.dragStartPosition.x + totalDeltaX, gridSnap);
		this.position.y = roundToNearest(this.dragStartPosition.y + totalDeltaY, gridSnap);
	}

	getAbsolutePosition(page: GraphPage): IVector2D {
		const parentNode = this.parentNode ? page.nodes.get(this.parentNode) : null;
		if (!parentNode) {
			return { x: this.position.x, y: this.position.y };
		}
		const parentPosition = parentNode.getAbsolutePosition(page);
		return {
			x: parentPosition.x + this.position.x,
			y: parentPosition.y + this.position.y,
		};
	}

	private static calcSize(maxNodeCount: number, displayName: string): IVector2D {
		const minHeight1 = (maxNodeCount + 1) * gridSize;
		const minHeight2 = productionNodeIconSize + productionNodeVerticalPadding * 2;
		const height = Math.max(minHeight1, minHeight2);
		const width = productionNodeIconSize + productionNodeHorizontalPadding * 2;
		return {
			x: ceilToNearest(width, gridSize),
			y: ceilToNearest(height, gridSize),
		};
	}

	reorderRecipeJoints(page: GraphPage) {
		const properties = this.properties;
		if (properties.type !== "production") {
			return;
		}
		const inputJoints = properties.resourceJoints.filter(joint => joint.type === "input");
		const outputJoints = properties.resourceJoints.filter(joint => joint.type === "output");
		if (inputJoints.length > 1) {
			this.reorderRecipeJointsRow(page, "input");
		}
		if (outputJoints.length > 1) {
			this.reorderRecipeJointsRow(page, "output");
		}
	}
	
	private reorderRecipeJointsRow(page: GraphPage, sameRowJointsType: "input" | "output") {
		const recipeNode = this as GraphNode<GraphNodeProductionProperties>;
		const sameRowJoints = recipeNode.properties.resourceJoints
			.filter(joint => joint.type === sameRowJointsType);
		if (sameRowJoints.length <= 1) {
			return;
		}
		
		const centerPoint = recipeNode.getAbsolutePosition(page);
		const layoutOrientation = (page.nodes.get(sameRowJoints[0].id)!.properties as GraphNodeResourceJointProperties).layoutOrientation;
		let zeroAxis: "x" | "y";
		let reverseOrder: boolean;
		switch (layoutOrientation) {
			case "top":
				zeroAxis = "y";
				reverseOrder = true;
				break;
			case "bottom":
				zeroAxis = "y";
				reverseOrder = true;
				break;
			case "left":
				zeroAxis = "x";
				reverseOrder = false;
				break;
			case "right":
				zeroAxis = "x";
				reverseOrder = false;
				break;
		}
		
		const jointTargets = sameRowJoints
			.map(srcJoint => {
				const jointNode = page.nodes.get(srcJoint.id) as GraphNode<GraphNodeResourceJointProperties>;
				// const angles = Array.from(jointNode.edges.values().map(edgeId => {
				// 	const edge = page.edges.get(edgeId);
				// 	let refJoint: GraphNode<GraphNodeResourceJointProperties> | undefined;
				// 	if (edge) {
				// 		let refJointId: Id | undefined;
				// 		if (edge.startNodeId === jointNode.id) {
				// 			refJointId = edge.endNodeId;
				// 		} else if (edge.endNodeId === jointNode.id) {
				// 			refJointId = edge.startNodeId;
				// 		}
				// 		if (refJointId) {
				// 			refJoint = page.nodes.get(refJointId) as GraphNode<GraphNodeResourceJointProperties>;
				// 		}
				// 	}
				// 	if (!refJoint) {
				// 		refJoint = jointNode;
				// 	}
				// 	const pos = refJoint.getAbsolutePosition(page);
				// 	const direction = {
				// 		x: zeroAxis !== "x" ? pos.x - centerPoint.x : 1,
				// 		y: zeroAxis !== "y" ? pos.y - centerPoint.y : 1,
				// 	};
				// 	let angle = Math.atan2(direction.y, direction.x);
				// 	// keep in range [-180, 180]
				// 	if (angle < -Math.PI) {
				// 		angle += 2 * Math.PI;
				// 	} else if (angle > Math.PI) {
				// 		angle -= 2 * Math.PI;
				// 	}
				// 	return angle;
				// }));
				// const angle = angles.reduce((a, b) => a + b, 0) / Math.max(1, angles.length);
				// return { node: jointNode, angle };
				const edge = page.edges.get(jointNode.edges.values().next().value || "");
				let refJoint: GraphNode<GraphNodeResourceJointProperties> | undefined;
				if (edge) {
					let refJointId: Id | undefined;
					if (edge.startNodeId === jointNode.id) {
						refJointId = edge.endNodeId;
					} else if (edge.endNodeId === jointNode.id) {
						refJointId = edge.startNodeId;
					}
					if (refJointId) {
						refJoint = page.nodes.get(refJointId) as GraphNode<GraphNodeResourceJointProperties>;
					}
				}
				if (!refJoint) {
					refJoint = jointNode;
				}
				const pos = refJoint.getAbsolutePosition(page);
				const direction = {
					x: zeroAxis !== "x" ? pos.x - centerPoint.x : 1,
					y: zeroAxis !== "y" ? pos.y - centerPoint.y : 1,
				};
				let angle = Math.atan2(direction.y, direction.x);
				// keep in range [-180, 180]
				if (angle < -Math.PI) {
					angle += 2 * Math.PI;
				} else if (angle > Math.PI) {
					angle -= 2 * Math.PI;
				}
				return { node: jointNode, angle };
			})
			.sort((a, b) => {
				const aPosSum = a.node.position.x + a.node.position.y;
				const bPosSum = b.node.position.x + b.node.position.y;
				return aPosSum - bPosSum;
			});
		
		if (jointTargets.every(({angle}) => angle === jointTargets[0].angle)) {
			return;
		}

		const originalPositions = jointTargets.map(t => $state.snapshot(t.node.position));

		const sortedTargets = jointTargets
			.toSorted((a, b) => {
				const angleA = a.angle;
				const angleB = b.angle;
				if (reverseOrder) {
					return angleB - angleA;
				} else {
					return angleA - angleB;
				}
			});
		
		for (let i = 0; i < sortedTargets.length; i++) {
			const target = sortedTargets[i];
			const newPosition = originalPositions[i];
			target.node.position.x = newPosition.x;
			target.node.position.y = newPosition.y;
		}

	}
}