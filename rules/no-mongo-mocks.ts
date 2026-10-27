import {ast, defineRule, registerDiagnostic} from '@biomejs/runtime/plugin';
import {isMockTrackerCall} from '../shared/node-test-mock.ts';

/** MongoDB collection methods that read or write data. */
const MONGO_METHODS = new Set([
	'aggregate',
	'bulkWrite',
	'countDocuments',
	'deleteMany',
	'deleteOne',
	'distinct',
	'estimatedDocumentCount',
	'find',
	'findOne',
	'findOneAndDelete',
	'findOneAndReplace',
	'findOneAndUpdate',
	'insertMany',
	'insertOne',
	'replaceOne',
	'updateMany',
	'updateOne',
	'watch'
]);

/** Ban `mock.method()` on MongoDB collection methods, so tests run real queries against a database. */
export const noMongoMocks = defineRule({
	query: ast('JS_CALL_EXPRESSION'),
	run(node) {
		if (!isMockTrackerCall(node, 'method')) return;
		const methodName = node.arguments?.args[1];
		if (methodName?.kind !== 'JS_STRING_LITERAL_EXPRESSION' || methodName.valueToken === undefined) return;
		const method = methodName.valueToken.slice(1, -1);
		if (!MONGO_METHODS.has(method)) return;
		registerDiagnostic(
			node,
			'error',
			`noMongoMocks: Mocking MongoDB \`${method}\` hides real query behavior. Run the test against a real MongoDB instance instead.`
		);
	}
});
