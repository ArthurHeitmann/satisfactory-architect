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
	type: "factory-output" | "factory-input";
	partClassName: string;
}
export type ProductionDetails = ProductionRecipeDetails | ProductionExtractionDetails | ProductionFactoryInOutDetails | GraphNodeFactoryReferenceProperties;
export interface GraphNodeProductionProperties extends GraphNodePropertiesBase {
	type: "production";
	details: ProductionDetails;
	multiplier: number;
	autoMultiplier: boolean;
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
	jointsToExternalNodes: Record<Id, Id>;
}
export type NewNodeDetails = ProductionDetails | GraphNodeSplitterMergerProperties;
export type GraphNodeProperties = GraphNodeProductionProperties | GraphNodeResourceJointProperties | GraphNodeSplitterMergerProperties;
export class GraphNode<T extends GraphNodeProperties = GraphNodeProperties> implements JsonSerializable<PageContext> {
	readonly id: Id;
	readonly context: PageContext;
	readonly position: Vector2D;
	private dragStartPosition: IVector2D;
	readonly priority: number;
	readonly edges: SvelteSet<Id>;
	parentNode: Id|null;
	readonly children: SvelteSet<Id>;
	readonly properties: T;
	size: IVector2D;

	constructor(id: Id, context: PageContext, position: IVector2D, priority: number, edges: Id[], parentNode: Id|null, children: Id[], properties: T, size?: IVector2D) {
		this.id = id;
		this.context = context;
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
		this.size = $state(size);
	}

	static makeProductionNode(
		idGen: IdGen,
		context: PageContext,
		position: IVector2D,
		edges: Id[],
		details: ProductionDetails,
	): {parent: GraphNode<GraphNodeProductionProperties>, children: GraphNode<GraphNodeResourceJointProperties>[]} {
		let inputs: SFRecipePart[];
		let outputs: SFRecipePart[];
		let multiplier = 1;
		const extInputNodeIds: Id[] = [];
		const extOutputNodeIds: Id[] = [];
		switch (details.type) {
			case "recipe":
				const recipe = satisfactoryDatabase.recipes[details.recipeClassName];
				if (!recipe) {
					throw new Error(`Recipe with class name ${details.recipeClassName} does not exist.`);
				}
				inputs = recipe.inputs;
				outputs = recipe.outputs;
				break;
			case "factory-output":
			case "factory-input":
				const recipePart = {
					itemClass: details.partClassName,
					amountPerMinute: 1,
				};
				if (details.type === "factory-output") {
					inputs = [recipePart];
					outputs = [];
				} else {
					inputs = [];
					outputs = [recipePart];
				}
				multiplier = 60;
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
			case "factory-reference":
				const page = context.appState.pages.find(p => p.id === details.factoryId);
				if (!page) {
					throw new Error(`Factory page with id ${details.factoryId} does not exist.`);
				}
				inputs = [];
				outputs = [];
				for (const node of page.nodes.values()) {
					if (node.properties.type !== "production") {
						continue;
					}
					if (node.properties.details.type === "factory-input") {
						inputs.push({
							itemClass: node.properties.details.partClassName,
							amountPerMinute: node.properties.multiplier,
						});
						extInputNodeIds.push(node.id);
					} else if (node.properties.details.type === "factory-output") {
						outputs.push({
							itemClass: node.properties.details.partClassName,
							amountPerMinute: node.properties.multiplier,
						});
						extOutputNodeIds.push(node.id);
					}
				}
				break;
			default:
				assertUnreachable(details);
		}
		const nodeSize = GraphNode.calcSize(Math.max(inputs.length, outputs.length));
		const children: GraphNode<GraphNodeResourceJointProperties>[] = [];
		const resourceJoints: ResourceJointInfo[] = [];
		const inputsGapSize = floorToNearest(nodeSize.y / inputs.length, gridSize);
		const outputsGapSize = floorToNearest(nodeSize.y / outputs.length, gridSize);
		const inputsYStart = -inputsGapSize/2 * (inputs.length - 1);
		const outputsYStart = -outputsGapSize/2 * (outputs.length - 1);
		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];
			const jointNode = new GraphNode(
				idGen.nextId(),
				context,
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
			if (details.type === "factory-reference") {
				const externalId = extInputNodeIds[i];
				details.jointsToExternalNodes[jointNode.id] = externalId;
			}
			children.push(jointNode);
			resourceJoints.push({ id: jointNode.id, type: "input" });
		}
		for (let i = 0; i < outputs.length; i++) {
			const output = outputs[i];
			const jointNode = new GraphNode(
				idGen.nextId(),
				context,
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
			if (details.type === "factory-reference") {
				const externalId = extOutputNodeIds[i];
				details.jointsToExternalNodes[jointNode.id] = externalId;
			}
			children.push(jointNode);
			resourceJoints.push({ id: jointNode.id, type: "output" });
		}
		const properties: GraphNodeProductionProperties = {
			type: "production",
			details,
			multiplier,
			autoMultiplier: false,
			resourceJoints: resourceJoints,
		};
		const parent = new GraphNode(idGen.nextId(), context, position, NodePriorities.RECIPE, edges, null, [], properties, nodeSize);
		return { parent, children };
	}

	static fromJSON(json: any, context: PageContext): GraphNode {
		return new GraphNode(
			json.id,
			context,
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
			if (this.parentNode)
				console.warn(`Node ${this.id} has no parent node, returning its own position as absolute position.`);
			return { x: this.position.x, y: this.position.y };
		}
		const parentPosition = parentNode.getAbsolutePosition(page);
		return {
			x: parentPosition.x + this.position.x,
			y: parentPosition.y + this.position.y,
		};
	}

	private static calcSize(maxNodeCount: number): IVector2D {
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

	updateExternalFactoryJoints(): void {
		if (this.properties.type !== "production" || this.properties.details.type !== "factory-reference") {
			return;
		}
		const details = this.properties.details;
		const externalPage = this.context.appState.pages.find(p => p.id === details.factoryId);
		if (!externalPage) {
			throw new Error(`External factory page with id ${details.factoryId} does not exist.`);
		}
		const currentlyUsedExternalJoints = Object.values(details.jointsToExternalNodes);
		const newUsedExternalJoints: Id[] = [];
		const jointsToAdd: {type: "input" | "output", itemClass: string, externalId: Id}[] = [];
		for (const node of externalPage.nodes.values()) {
			if (node.properties.type !== "production") {
				continue;
			}
			if (node.properties.details.type === "factory-input" || node.properties.details.type === "factory-output") {
				newUsedExternalJoints.push(node.id);
				if (currentlyUsedExternalJoints.includes(node.id)) {
					continue;
				}
				const type = node.properties.details.type === "factory-input" ? "input" : "output";
				jointsToAdd.push({
					type,
					itemClass: node.properties.details.partClassName,
					externalId: node.id,
				});
			}
		}
		// delete old joints
		const extToLocalJoints: Record<Id, Id> = {};
		for (const [localId, externalId] of Object.entries(details.jointsToExternalNodes)) {
			extToLocalJoints[externalId] = localId;
		}
		const localJointsToRemove = currentlyUsedExternalJoints
			.filter(id => !newUsedExternalJoints.includes(id))
			.map(id => extToLocalJoints[id]);
		this.properties.resourceJoints = this.properties.resourceJoints
			.filter(joint => !localJointsToRemove.includes(joint.id));
		for (const localJointId of localJointsToRemove) {
			delete details.jointsToExternalNodes[localJointId];
			this.children.delete(localJointId);
			this.context.page.removeNode(localJointId);
		}
		// add new joints
		for (const joint of jointsToAdd) {
			const newJointTmpPosition = {
				x: this.size.x / 2,
				y: this.size.y / 2,
			}
			const newJoint: GraphNode<GraphNodeResourceJointProperties> = new GraphNode(
				this.context.page.idGen.nextId(),
				this.context,
				newJointTmpPosition,
				NodePriorities.RESOURCE_JOINT,
				[],
				this.id,
				[],
				{
					type: "resource-joint",
					resourceClassName: joint.itemClass,
					jointType: joint.type,
					locked: true,
					layoutOrientation: joint.type === "input" ? "left" : "right",
				}
			);
			this.context.page.nodes.set(newJoint.id, newJoint);
			this.properties.resourceJoints.push({ id: newJoint.id, type: joint.type });
			details.jointsToExternalNodes[newJoint.id] = joint.externalId;
			this.children.add(newJoint.id);
		}

		this.onJointCountChanged();
	}

	private onJointCountChanged(): void {
		if (this.properties.type !== "production") {
			return;
		}
		function nodeCmp(a: GraphNode, b: GraphNode): number {
			const aPosSum = a.position.x + a.position.y;
			const bPosSum = b.position.x + b.position.y;
			return aPosSum - bPosSum;
		}
		const inputs = this.properties.resourceJoints.filter(joint => joint.type === "input")
			.map(joint => this.context.page.nodes.get(joint.id)!)
			.sort(nodeCmp);
		const outputs = this.properties.resourceJoints.filter(joint => joint.type === "output")
			.map(joint => this.context.page.nodes.get(joint.id)!)
			.sort(nodeCmp);
		const maxNodeCount = Math.max(inputs.length, outputs.length);
		this.size = GraphNode.calcSize(maxNodeCount);

		const inputsGapSize = floorToNearest(this.size.y / inputs.length, gridSize);
		const outputsGapSize = floorToNearest(this.size.y / outputs.length, gridSize);
		const inputsYStart = -inputsGapSize/2 * (inputs.length - 1);
		const outputsYStart = -outputsGapSize/2 * (outputs.length - 1);
		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];
			input.position.x = -this.size.x / 2;
			input.position.y = inputsYStart + inputsGapSize * i;
		}
		for (let i = 0; i < outputs.length; i++) {
			const output = outputs[i];
			output.position.x = this.size.x / 2;
			output.position.y = outputsYStart + outputsGapSize * i;
		}
	}
}
