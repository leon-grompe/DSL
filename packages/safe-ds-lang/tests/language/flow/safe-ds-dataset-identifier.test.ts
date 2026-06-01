import { AstUtils } from 'langium';
import { describe, expect, it } from 'vitest';
import { isSdsCall, isSdsPipeline, isSdsPlaceholder, isSdsReference } from '../../../src/language/generated/ast.js';
import { createSafeDsServices } from '../../../src/language/index.js';
import { NodeFileSystem } from 'langium/node';
import { fail } from 'node:assert';
import { getNodeOfType } from '../../helpers/nodeFinder.js';

const services = (await createSafeDsServices(NodeFileSystem)).SafeDs;
const identifier = services.flow.DatasetIdentifier;

// ---------------------------------------------------------------------------
// Shared parse for callReferences*Set integration tests
// ---------------------------------------------------------------------------

const callRefCode = `
    package test
    fun getTable() -> result: Table
    fun useData(data: Table) -> result: Int
    pipeline myPipeline {
        val data = getTable();
        val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7);
        val valSet, val testSet = restSet.splitRows(percentageInFirst = 0.5);
        val r1 = useData(trainSet);
        val r2 = useData(valSet);
        val r3 = useData(testSet);
        val r4 = useData(data);
    }
`;
const callRefPipeline = await getNodeOfType(services, callRefCode, isSdsPipeline);

// Returns the first call in callRefPipeline whose argument is a reference to the named placeholder.
function findCallWithArg(argName: string) {
    return (
        AstUtils.streamAllContents(callRefPipeline)
            .filter(isSdsCall)
            .find((call) =>
                call.argumentList.arguments.some(
                    (arg) =>
                        isSdsReference(arg.value) &&
                        isSdsPlaceholder(arg.value.target.ref) &&
                        arg.value.target.ref.name === argName,
                ),
            ) ?? fail(`No call found with argument '${argName}'`)
    );
}

// ---------------------------------------------------------------------------
// getTrainingSetPlaceholder
// ---------------------------------------------------------------------------

describe('getTrainingSetPlaceholder', async () => {
    const cases: GetPlaceholderTest[] = [
        {
            description: 'returns undefined when no split exists',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline { val data = getTable(); }
            `,
            expectedName: undefined,
        },
        {
            description: 'returns first assignee of a direct split (Scenario A)',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7);
                }
            `,
            expectedName: 'trainSet',
        },
        {
            description: 'returns first pipeline-level assignee when split is inside a segment (Scenario A)',
            code: `
                package test
                fun getTable() -> result: Table
                segment wrapSplit(data: Table) -> (trainSet: Table, restSet: Table) {
                    yield trainSet, yield restSet = data.splitRows(percentageInFirst = 0.7)
                    yield trainSet = trainSet
                    yield restSet = restSet
                }
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val restSet = wrapSplit(data);
                }
            `,
            expectedName: 'trainSet',
        },
        {
            description: 'returns first pipeline-level output of a split-all segment (Scenario B)',
            code: `
                package test
                fun getTable() -> result: Table
                segment splitAll(data: Table) -> (trainSet: Table, valSet: Table, testSet: Table) {
                    val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7)
                    val valSet, val testSet = restSet.splitRows(percentageInFirst = 0.5)
                    yield trainSet = trainSet
                    yield valSet = valSet
                    yield testSet = testSet
                }
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val valSet, val testSet = splitAll(data);
                }
            `,
            expectedName: 'trainSet',
        },
    ];

    it.each(cases)('$description', async ({ code, expectedName }) => {
        const pipeline = await getNodeOfType(services, code, isSdsPipeline);
        const result = identifier.getTrainingSetPlaceholder(pipeline.body.statements);
        expect(result?.name).toBe(expectedName);
    });
});

// ---------------------------------------------------------------------------
// getValidationSetPlaceholder
// ---------------------------------------------------------------------------

describe('getValidationSetPlaceholder', async () => {
    const cases: GetPlaceholderTest[] = [
        {
            description: 'returns undefined when no split exists',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline { val data = getTable(); }
            `,
            expectedName: undefined,
        },
        {
            description: 'returns undefined when only one split exists',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7);
                }
            `,
            expectedName: undefined,
        },
        {
            description: 'returns first assignee of the second direct split (Scenario A)',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7);
                    val valSet, val testSet = restSet.splitRows(percentageInFirst = 0.5);
                }
            `,
            expectedName: 'valSet',
        },
        {
            description: 'returns first pipeline-level assignee when second split is inside a segment (Scenario A)',
            code: `
                package test
                fun getTable() -> result: Table
                segment splitRest(restSet: Table) -> (valSet: Table, testSet: Table) {
                    val valSet, val testSet = restSet.splitRows(percentageInFirst = 0.5)
                    yield valSet = valSet
                    yield testSet = testSet
                }
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7);
                    val valSet, val testSet = splitRest(restSet);
                }
            `,
            expectedName: 'valSet',
        },
        {
            description: 'returns second pipeline-level output of a split-all segment (Scenario B)',
            code: `
                package test
                fun getTable() -> result: Table
                segment splitAll(data: Table) -> (trainSet: Table, valSet: Table, testSet: Table) {
                    val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7)
                    val valSet, val testSet = restSet.splitRows(percentageInFirst = 0.5)
                    yield trainSet = trainSet
                    yield valSet = valSet
                    yield testSet = testSet
                }
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val valSet, val testSet = splitAll(data);
                }
            `,
            expectedName: 'valSet',
        },
    ];

    it.each(cases)('$description', async ({ code, expectedName }) => {
        const pipeline = await getNodeOfType(services, code, isSdsPipeline);
        const result = identifier.getValidationSetPlaceholder(pipeline.body.statements);
        expect(result?.name).toBe(expectedName);
    });
});

// ---------------------------------------------------------------------------
// getTestSetPlaceholder
// ---------------------------------------------------------------------------

describe('getTestSetPlaceholder', async () => {
    const cases: GetPlaceholderTest[] = [
        {
            description: 'returns undefined when no split exists',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline { val data = getTable(); }
            `,
            expectedName: undefined,
        },
        {
            description: 'returns the rest set (assignee[1] of the first split) when no validation split exists (Scenario A)',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val testSet = data.splitRows(percentageInFirst = 0.7);
                }
            `,
            expectedName: 'testSet',
        },
        {
            description: 'returns second assignee of the validation split (Scenario A)',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7);
                    val valSet, val testSet = restSet.splitRows(percentageInFirst = 0.5);
                }
            `,
            expectedName: 'testSet',
        },
        {
            description: 'returns third pipeline-level output of a split-all segment (Scenario B)',
            code: `
                package test
                fun getTable() -> result: Table
                segment splitAll(data: Table) -> (trainSet: Table, valSet: Table, testSet: Table) {
                    val trainSet, val restSet = data.splitRows(percentageInFirst = 0.7)
                    val valSet, val testSet = restSet.splitRows(percentageInFirst = 0.5)
                    yield trainSet = trainSet
                    yield valSet = valSet
                    yield testSet = testSet
                }
                pipeline myPipeline {
                    val data = getTable();
                    val trainSet, val valSet, val testSet = splitAll(data);
                }
            `,
            expectedName: 'testSet',
        },
    ];

    it.each(cases)('$description', async ({ code, expectedName }) => {
        const pipeline = await getNodeOfType(services, code, isSdsPipeline);
        const result = identifier.getTestSetPlaceholder(pipeline.body.statements);
        expect(result?.name).toBe(expectedName);
    });
});

// ---------------------------------------------------------------------------
// callReferences*Set  (integration — uses callRefPipeline parsed above)
// ---------------------------------------------------------------------------

describe('callReferencesTrainingSet', () => {
    const stmts = callRefPipeline.body.statements;

    it('returns true when argument is derived from training set', () => {
        expect(identifier.callReferencesTrainingSet(findCallWithArg('trainSet'), stmts)).toBe(true);
    });
    it('returns false when argument is from validation set', () => {
        expect(identifier.callReferencesTrainingSet(findCallWithArg('valSet'), stmts)).toBe(false);
    });
    it('returns false when argument is from test set', () => {
        expect(identifier.callReferencesTrainingSet(findCallWithArg('testSet'), stmts)).toBe(false);
    });
    it('returns false when argument is original (unsplit) data', () => {
        expect(identifier.callReferencesTrainingSet(findCallWithArg('data'), stmts)).toBe(false);
    });
});

describe('callReferencesValidationSet', () => {
    const stmts = callRefPipeline.body.statements;

    it('returns false when argument is from training set', () => {
        expect(identifier.callReferencesValidationSet(findCallWithArg('trainSet'), stmts)).toBe(false);
    });
    it('returns true when argument is derived from validation set', () => {
        expect(identifier.callReferencesValidationSet(findCallWithArg('valSet'), stmts)).toBe(true);
    });
    it('returns false when argument is from test set', () => {
        expect(identifier.callReferencesValidationSet(findCallWithArg('testSet'), stmts)).toBe(false);
    });
    it('returns false when argument is original (unsplit) data', () => {
        expect(identifier.callReferencesValidationSet(findCallWithArg('data'), stmts)).toBe(false);
    });
});

describe('callReferencesTestSet', () => {
    const stmts = callRefPipeline.body.statements;

    it('returns false when argument is from training set', () => {
        expect(identifier.callReferencesTestSet(findCallWithArg('trainSet'), stmts)).toBe(false);
    });
    it('returns false when argument is from validation set', () => {
        expect(identifier.callReferencesTestSet(findCallWithArg('valSet'), stmts)).toBe(false);
    });
    it('returns true when argument is derived from test set', () => {
        expect(identifier.callReferencesTestSet(findCallWithArg('testSet'), stmts)).toBe(true);
    });
    it('returns false when argument is original (unsplit) data', () => {
        expect(identifier.callReferencesTestSet(findCallWithArg('data'), stmts)).toBe(false);
    });
});

// ---------------------------------------------------------------------------

interface GetPlaceholderTest {
    description: string;
    code: string;
    expectedName: string | undefined;
}
