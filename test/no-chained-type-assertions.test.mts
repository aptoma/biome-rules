import {testRule} from './rule-tester.mts';

testRule('no-chained-type-assertions.ts', {
	valid: [
		'const value = input as User;',
		'const value = (input as User);',
		'const value = ({ id: 1 } as const) as const;'
	],
	invalid: [
		{name: 'as chain', code: 'const value = input as unknown as User;', errors: 1},
		{name: 'parenthesized chain', code: 'const value = (input as unknown) as User;', errors: 1},
		{name: 'angle-bracket chain', code: 'const value = <User>(<unknown>input);', errors: 1},
		{name: 'mixed const chain', code: 'const value = ({ id: 1 } as const) as User;', errors: 1}
	]
});
