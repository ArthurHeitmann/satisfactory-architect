import type { Id } from "../../../../shared/types_serialization.js";

export type { Id };

export class IdGen {
	private currentId: number;
	private prefix: string = "";

	constructor(currentId: number = 0) {
		this.currentId = currentId;
	}

	private static parseId(id: Id): number {
		if (id.includes("-")) {
			return Number(id.split("-")[1]);
		}
		return Number(id);
	}

	static fromJson(json: any): IdGen {
		const num = IdGen.parseId(json);
		if (isNaN(num)) {
			throw new Error("Invalid ID: not a number");
		}
		return new IdGen(num);
	}

	replaceFromJson(json: any): void {
		const num = IdGen.parseId(json);
		if (isNaN(num)) {
			throw new Error("Invalid ID: not a number");
		}
		this.currentId = num;
	}

	replaceFromJsonIfHigher(json: any): void {
		const num = IdGen.parseId(json);
		if (isNaN(num)) {
			throw new Error("Invalid ID: not a number");
		}
		if (num > this.currentId) {
			this.currentId = num;
		}
	}

	toJSON(): string {
		return this.currentId.toString();
	}

	nextId(): Id {
		const id = this.getCurrentId();
		this.currentId++;
		return id;
	}

	getCurrentId(): Id {
		return `${this.prefix}${this.currentId}`;
	}

	setPrefix(prefix: string): void {
		if (!prefix.endsWith("-")) {
			prefix += "-";
		}
		this.prefix = prefix;
	}
}

export class IdMapper {
	private idGen: IdGen;
	private idMap: Map<Id, Id>;

	constructor(idGen: IdGen) {
		this.idGen = idGen;
		this.idMap = new Map<Id, Id>();
	}

	mapId(id: Id): Id {
		if (this.idMap.has(id)) {
			return this.idMap.get(id)!;
		}
		const newId = this.idGen.nextId();
		this.idMap.set(id, newId);
		return newId;
	}

	hasOldId(id: Id): boolean {
		return this.idMap.has(id);
	}
}

export type PasteSource = "local" | "external";
