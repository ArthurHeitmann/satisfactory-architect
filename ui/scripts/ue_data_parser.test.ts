import { expect, test } from 'vitest'
import { parseUeData } from './ue_data_parser';


test("primitive - integer", () => {
	const input = `42`;
	const expected = 42;
	expect(parseUeData(input)).toEqual(expected);
});
test("primitive - float", () => {
	const input = `3.14`;
	const expected = 3.14;
	expect(parseUeData(input)).toEqual(expected);
});
test("primitive - string", () => {
	const input = `"Hello, World!"`;
	const expected = "Hello, World!";
	expect(parseUeData(input)).toEqual(expected);
});
test("primitive - string - like int", () => {
	const input = `"1"`;
	const expected = "1";
	expect(parseUeData(input)).toEqual(expected);
});
test("primitive - string - like boolean", () => {
	const input = `"True"`;
	const expected = "True";
	expect(parseUeData(input)).toEqual(expected);
});
test("primitive - boolean true", () => {
	const input = `True`;
	const expected = true;
	expect(parseUeData(input)).toEqual(expected);
});
test("primitive - boolean false", () => {
	const input = `False`;
	const expected = false;
	expect(parseUeData(input)).toEqual(expected);
});
test("primitive - variable", () => {
	const input = `SOME_CONSTANT`;
	const expected = "SOME_CONSTANT";
	expect(parseUeData(input)).toEqual(expected);
});

test("empty list", () => {
	const input = `()`;
	const expected = [];
	expect(parseUeData(input)).toEqual(expected);
});
test("list with primitives", () => {
	const input = `(1, 2.5, "test", True)`;
	const expected = [1, 2.5, "test", true];
	expect(parseUeData(input)).toEqual(expected);
});
test("list with nested lists", () => {
	const input = `((1, 2), (3, 4))`;
	const expected = [[1, 2], [3, 4]];
	expect(parseUeData(input)).toEqual(expected);
});

test("map with one element", () => {
	const input = `(Key="Value")`;
	const expected = { Key: "Value" };
	expect(parseUeData(input)).toEqual(expected);
});
test("map with multiple elements", () => {
	const input = `(Key1="Value1", Key2=42, Key3=True)`;
	const expected = { Key1: "Value1", Key2: 42, Key3: true };
	expect(parseUeData(input)).toEqual(expected);
});
test("map with nested elements", () => {
	const input = `(Key1=(SubKey1="SubValue1"), Key2=(SubKey2=3.14))`;
	const expected = { Key1: { SubKey1: "SubValue1" }, Key2: { SubKey2: 3.14 } };
	expect(parseUeData(input)).toEqual(expected);
});
