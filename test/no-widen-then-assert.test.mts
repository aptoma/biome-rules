import {testRule} from './rule-tester.mts';

testRule('no-widen-then-assert.ts', {
	valid: [
		"const source = { id: 'first' }; const widened: unknown = source;",
		'declare const input: unknown; const parsed = input as { readonly id: string };',
		{
			name: 'assertion in a nested function',
			code: "const source = { id: 'a' }; const widened: unknown = source; const read = () => widened as { id: string };"
		},
		{
			name: 'assertion inside the initializer',
			code: "const widened: unknown = (widened as { id: string }) ?? { id: 'a' };"
		},
		{
			name: 'object widened then asserted to a primitive',
			code: "const source = { id: 'a' }; const widened: object = source; const parsed = widened as string;"
		},
		{
			name: 'broad record asserted to another broad record',
			code: "const source = { id: 'a' }; const widened: Record<string, unknown> = source; const parsed = widened as { [key: string]: any };"
		},
		{
			name: 'unknown evidence source',
			code: 'function read(input: unknown) { const widened: unknown = input; return widened as string; }'
		},
		{
			name: 'mutable binding',
			code: "let widened: unknown = { id: 'a' }; const parsed = widened as { id: string };"
		}
	],
	invalid: [
		{
			code: "const source = { id: 'second' }; const widened: unknown = source; const parsed = widened as { readonly id: string };",
			errors: 1
		},
		{
			name: 'widening assertion in the initializer and angle-bracket assertion',
			code: 'const widened = (42 as unknown); const parsed = <number>widened;',
			errors: 1
		},
		{
			name: 'parameter annotation evidence inside a function',
			code: 'function read(input: Item) { const widened: object = input; return widened as Item; }',
			errors: 1
		},
		{
			name: 'record widened then asserted to a concrete record',
			code: "const source = { id: 'a' }; const widened: Readonly<Record<PropertyKey, unknown>> = source; const parsed = widened as Record<string, string>;",
			errors: 1
		},
		{
			name: 'const chain evidence',
			code: 'const first = [1]; const second = first; const widened: any = second; const parsed = widened as number[];',
			errors: 1
		}
	]
});
