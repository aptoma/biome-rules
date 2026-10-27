import {testRule} from './rule-tester.mts';

testRule('no-mongo-mocks.ts', {
	valid: [
		"mock.method(service, 'load');",
		'mock.method(collection, method);',
		'mock.fn(collection.findOne);',
		'collection.findOne({id: 1});',
		"other.method(collection, 'findOne');",
		'mock.method(collection);'
	],
	invalid: [
		{code: "mock.method(collection, 'findOne', async () => null);", errors: 1},
		{code: 't.mock.method(db.collection("users"), "updateOne");', errors: 1},
		{code: "mock.method(Collection.prototype, 'find');", errors: 1},
		{code: "mock.method(users, 'insertOne'); mock.method(users, 'aggregate');", errors: 2}
	]
});
