import {testRule} from './rule-tester.mts';

testRule('no-unknown-returns.ts', {
	valid: [
		'type ImportedValue = unknown;',
		'function parse(): ImportedValue { return input; }',
		'function parse(): User { return user; }',
		'function infer() { return input; }',
		'function generic<Value>(): Value { return value; }',
		'type Value = unknown; function generic<Value>(): Value { return value; }',
		'type Key = unknown; type Mapped<Input> = { [Key in keyof Input]: () => Key };',
		'type Item = unknown; type Unpacked<Input> = Input extends Promise<infer Item> ? () => Item : never;',
		'function cause(): { cause: unknown } { return { cause: input }; }',
		'type Result = { value: unknown }; function load(): Result { return result; }',
		'function load(): Promise<User> { return promise; }',
		'type Identity<T> = T; function load(): Identity<User> { return user; }',
		'type Value = unknown; function outer() { type Value = User; function load(): Value { return user; } }'
	],
	invalid: [
		{code: 'function load(): unknown { return input; }', errors: 1},
		{code: 'const load = (): unknown => input;', errors: 1},
		{code: 'type Loader = () => unknown;', errors: 1},
		{code: 'interface Loader { load(): unknown }', errors: 1},
		{code: 'declare function load(): unknown;', errors: 1},
		{code: 'function load(): string | unknown { return input; }', errors: 1},
		{code: 'function load(): Promise<unknown> { return promise; }', errors: 1},
		{code: 'type UnknownValue = unknown; function load(): UnknownValue { return input; }', errors: 1},
		{code: 'type Item = unknown; type Fallback<Input> = Input extends infer Item ? string : () => Item;', errors: 1},
		{code: 'function outer() { type Result = unknown; function load(): Result { return input; } }', errors: 1},
		{code: 'type Identity<T> = T; function load(): Identity<unknown> { return input; }', errors: 1},
		{code: 'type Identity<T> = T; function load(): Identity<Identity<unknown>> { return input; }', errors: 1},
		{
			code: 'type Identity<T> = T; type Wrapped<T> = Promise<Identity<T>>; function load(): Wrapped<unknown> { return promise; }',
			errors: 1
		}
	]
});
