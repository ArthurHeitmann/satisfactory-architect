
export type Id = string;

export class IdGen {
	private currentId: number;

	constructor(currentId: number = 0) {
		this.currentId = currentId;
	}

	static fromJson(json: any): IdGen {
		return new IdGen(Number(json));
	}

	toJSON(): number {
		return this.currentId;
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
