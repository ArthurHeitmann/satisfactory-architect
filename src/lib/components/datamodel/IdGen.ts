
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
