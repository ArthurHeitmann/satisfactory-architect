
/*
Primitive:
- string
- int (42)
- float (3.14)
- bool (True/False)
- variable (Some_Variable)

List: ( item1, item2, ... )

Map: ( key=Element )

Element = Primitive | List | Map
*/

type UePrimitive = string | number | boolean;
type UeElement = UePrimitive | UeElement[] | { [key: string]: UeElement };

export function parseUeData(string: string): UeElement {
	const cursor = new Cursor(string);
	return parseElement(cursor);
}

function parseElement(cursor: Cursor): UeElement {
	if (cursor.currentChar === null) {
		throw new Error(`Unexpected end of input \n${cursor.errorContext()}`);
	}

	cursor.skipWhitespace();

	switch (cursor.currentChar) {
		case '"':
			return parseString(cursor);
		case '(':
			return parseListOrMap(cursor);
		default:
			if (isNumber(cursor)) {
				return parseNumber(cursor);
			} else if (isBoolean(cursor)) {
				return parseBoolean(cursor);
			} else if (isVariable(cursor)) {
				return parseVariable(cursor);
			} else {
				throw new Error(`Unexpected character: "${cursor.currentChar}" \n${cursor.errorContext()}`);
			}
	}
}

function isNumber(cursor: Cursor): boolean {
	return cursor.hasNextPattern(/^[-+]?\d+(\.\d+)?/);
}

function isBoolean(cursor: Cursor): boolean {
	return cursor.hasNextString("True") || cursor.hasNextString("False");
}

function isVariable(cursor: Cursor): boolean {
	return /[A-Za-z_]/.test(cursor.currentChar ?? "");
}

function parseNumber(cursor: Cursor): number {
	const numberStr = cursor.match(/^[-+]?\d+(\.\d+)?/);
	if (numberStr === null) {
		throw new Error(`Expected a number but found: "${cursor.currentChar}" \n${cursor.errorContext()}`);
	}
	cursor.advance(numberStr.length);
	return Number(numberStr);
}

function parseBoolean(cursor: Cursor): boolean {
	if (cursor.hasNextString("True")) {
		cursor.advance(4);
		return true;
	} else if (cursor.hasNextString("False")) {
		cursor.advance(5);
		return false;
	} else {
		throw new Error(`Expected a boolean but found: "${cursor.currentChar}" \n${cursor.errorContext()}`);
	}
}

function parseVariable(cursor: Cursor): string {
	const variableName = cursor.match(/^[A-Za-z_][A-Za-z0-9_]*/);
	if (variableName === null) {
		throw new Error(`Expected a variable but found: "${cursor.currentChar}" \n${cursor.errorContext()}`);
	}
	cursor.advance(variableName.length);
	return variableName;
}

function parseString(cursor: Cursor): string {
	const string = cursor.match(/^"[^"]*"/);
	if (string === null) {
		throw new Error(`Expected a string but found: "${cursor.currentChar}" \n${cursor.errorContext()}`);
	}
	cursor.advance(string.length);
	if (string.length < 2 || string[0] !== '"' || string[string.length - 1] !== '"') {
		throw new Error(`Invalid string format: ${string} \n${cursor.errorContext()}`);
	}
	return string.slice(1, -1);
}

function parseListOrMap(cursor: Cursor): UeElement[] | { [key: string]: UeElement } {
	cursor.advance(); // Skip the opening '('
	let type: "list" | "map" | null = null;
	function setType(newType: "list" | "map") {
		if (type && type !== newType) {
			throw new Error(`Expected a ${type} but found a ${newType} \n${cursor.errorContext()}`);
		}
		type = newType;
	}
	
	const list: UeElement[] = [];
	const map: { [key: string]: UeElement } = {};
	while (cursor.currentChar && cursor.currentChar !== ')') {
		cursor.skipWhitespace();

		if (isMapKey(cursor)) {
			const key = parseMapKey(cursor);
			cursor.skipWhitespace();
			const value = parseElement(cursor);
			map[key] = value;
			setType("map");
		}
		else {
			const element = parseElement(cursor);
			list.push(element);
			setType("list");
		}

		cursor.skipWhitespace();
		
		if (cursor.currentChar === ',') {
			cursor.advance(); // Skip the comma
			cursor.skipWhitespace();
		}
		else if (cursor.currentChar !== ')') {
			throw new Error(`Expected ',' or ')' but found: "${cursor.currentChar}" \n${cursor.errorContext()}`);
		}
	}

	if (cursor.currentChar !== ')') {
		throw new Error(`Expected ')' but found: "${cursor.currentChar}" \n${cursor.errorContext()}`);
	}

	cursor.advance(); // Skip the closing ')'

	if (type === "map") {
		return map;
	} else if (type === "list") {
		return list;
	} else {
		return [];
	}
}

function isMapKey(cursor: Cursor): boolean {
	return cursor.hasNextPattern(/^[A-Za-z_][A-Za-z0-9_\[\]]*=/);
}

function parseMapKey(cursor: Cursor): string {
	const keyMatch = cursor.match(/^[A-Za-z_][A-Za-z0-9_\[\]]*=/);
	if (keyMatch === null) {
		throw new Error(`Expected a map key but found: "${cursor.currentChar}" \n${cursor.errorContext()}`);
	}
	const key = keyMatch.slice(0, -1); // Remove the '=' at the end
	cursor.advance(keyMatch.length);
	return key;
}

class Cursor {
	private text: string;
	private _position: number;

	constructor(text: string) {
		this.text = text;
		this._position = 0;
	}

	get currentChar(): string | null {
		if (this._position < this.text.length) {
			return this.text[this._position];
		}
		return null;
	}

	get position(): number {
		return this._position;
	}

	hasNextString(text: string): boolean {
		const remainingText = this.text.slice(this._position, this._position + text.length);
		return remainingText === text;
	}

	hasNextPattern(pattern: RegExp): boolean {
		const remainingText = this.text.slice(this._position);
		return pattern.test(remainingText);
	}

	match(pattern: RegExp): string | null {
		const match = this.text.slice(this._position).match(pattern);
		if (match) {
			return match[0];
		}
		return null;
	}

	advance(steps = 1): void {
		if (this._position < this.text.length) {
			this._position += steps;
		}
	}

	slice(start: number, end: number): string {
		if (start < 0 || end > this.text.length || start > end) {
			throw new Error("Invalid slice range");
		}
		return this.text.slice(start, end);
	}

	skipWhitespace(): void {
		while (this.currentChar && /\s/.test(this.currentChar)) {
			this.advance();
		}
	}

	errorContext(): string {
		const start = Math.max(0, this._position - 10);
		const end = Math.min(this.text.length, this._position + 10);
		return `"${this.slice(start, end)}" at position ${this._position} at "${this.currentChar}"`;
	}
}
