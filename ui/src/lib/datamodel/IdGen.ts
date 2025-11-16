
export type Id = string;

export class IdGen {
	private currentId: number;

	constructor(currentId: number = 0) {
		this.currentId = currentId;
	}

	static fromJson(json: any): IdGen {
		const num = Number(json);
		if (isNaN(num)) {
			throw new Error("Invalid ID: not a number");
		}
		return new IdGen(num);
	}

	replaceFromJson(json: any): void {
		const num = Number(json);
		if (isNaN(num)) {
			throw new Error("Invalid ID: not a number");
		}
		this.currentId = num;
	}

	toJSON(): string {
		return this.currentId.toString();
	}

	nextId(): Id {
		return `${this.currentId++}`;
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
