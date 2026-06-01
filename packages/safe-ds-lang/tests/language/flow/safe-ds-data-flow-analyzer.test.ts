import { AstUtils } from 'langium';
import { describe, expect, it } from 'vitest';
import { isSdsCall, isSdsFunction, isSdsPipeline, isSdsPlaceholder, isSdsReference } from '../../../src/language/generated/ast.js';
import { createSafeDsServices } from '../../../src/language/index.js';
import { NodeFileSystem } from 'langium/node';
import { getNodeOfType } from '../../helpers/nodeFinder.js';

const services = (await createSafeDsServices(NodeFileSystem)).SafeDs;
const analyzer = services.flow.DataFlowAnalyzer;

// ---------------------------------------------------------------------------
// isData
// ---------------------------------------------------------------------------

describe('isData', async () => {
    const cases: IsDataTest[] = [
        {
            description: 'returns true for a Table-typed variable',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline p { val t = getTable(); }
            `,
            expected: true,
        },
        {
            description: 'returns false for an Int-typed variable',
            code: `
                package test
                fun getInt() -> result: Int
                pipeline p { val n = getInt(); }
            `,
            expected: false,
        },
        {
            description: 'returns false for a String-typed variable',
            code: `
                package test
                fun getString() -> result: String
                pipeline p { val s = getString(); }
            `,
            expected: false,
        },
    ];

    it.each(cases)('$description', async ({ code, expected }) => {
        const placeholder = await getNodeOfType(services, code, isSdsPlaceholder);
        expect(analyzer.isData(placeholder)).toBe(expected);
    });
});


// ---------------------------------------------------------------------------
// Shared parse for isSpecificCall + extractAssignmentsWithSpecificCall
// ---------------------------------------------------------------------------

// Pipeline with one of each call shape:
//   [0] direct splitRows call
//   [1] segment call whose body contains splitRows
//   [2] segment call whose body does NOT contain splitRows
//   [3] direct fit call
const sharedCode = `
    package test
    fun getTable() -> result: Table
    fun getImageList() -> result: ImageDataset
    fun fit(t: Table) -> result: Classifier
    fun transform(t: Table) -> result: Table
    segment splitWrapper(data: Table) -> (a: Table, b: Table) {
        val a, val b = data.splitRows(percentageInFirst = 0.7)
        yield a = a
        yield b = b
    }
    segment noSplitWrapper(data: Table) -> result: Table {
        val r = transform(data)
        yield result = r
    }
    pipeline myPipeline {
        val tabularData = getTable();
        val imageData = getImageList();
        val a, val b = tabularData.splitRows(percentageInFirst = 0.7);
        val a1, val b1 = imageData.split(percentageInFirst = 0.7);
        val c, val d = splitWrapper(tabularData);
        val e = noSplitWrapper(tabularData);
        val f = fit(tabularData);
    }
`;
const sharedPipeline = await getNodeOfType(services, sharedCode, isSdsPipeline);
const sharedStatements = sharedPipeline.body.statements;


// ---------------------------------------------------------------------------
// isSpecificCall
// ---------------------------------------------------------------------------

describe('isSpecificCall', () => {
    // statements: [0] tabularData, [1] imageData, [2] splitRows, [3] split, [4] splitWrapper, [5] noSplitWrapper, [6] fit
    const cases: IsSpecificCallTest[] = [
        {
            description: 'returns true for splitRows when searching for "split" (alias)',
            statementIndex: 2,
            callableName: 'split',
            expected: true,
        },
        {
            description: 'returns true for splitRows when searching for "splitRows"',
            statementIndex: 2,
            callableName: 'splitRows',
            expected: true,
        },
        {
            description: 'returns true for split when searching for "split"',
            statementIndex: 3,
            callableName: 'split',
            expected: true,
        },
        {
            description: 'returns true for split when searching for "splitRows"',
            statementIndex: 3,
            callableName: 'splitRows',
            expected: true,
        },
        {
            description: 'returns true when callable name matches exactly',
            statementIndex: 6,
            callableName: 'fit',
            expected: true,
        },
        {
            description: 'returns false when callable name does not match',
            statementIndex: 6,
            callableName: 'split',
            expected: false,
        },
        {
            description: 'returns false for a segment call (callable is not a function)',
            statementIndex: 4,
            callableName: 'splitWrapper',
            expected: false,
        },
    ];

    it.each(cases)('$description', ({ statementIndex, callableName, expected }) => {
        expect(analyzer.isSpecificCall(sharedStatements[statementIndex]!, callableName)).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// extractAssignmentsWithSpecificCall
// ---------------------------------------------------------------------------

describe('extractAssignmentsWithSpecificCall', () => {
    // statements: [0] tabularData, [1] imageData, [2] splitRows, [3] split, [4] splitWrapper, [5] noSplitWrapper, [6] fit
    const cases: ExtractAssignmentsTest[] = [
        {
            description: 'returns empty array when no matching call exists',
            callableName: 'unknownFunc',
            expectedIndices: [],
        },
        {
            description: 'returns both direct split calls and the segment wrapping a split',
            callableName: 'split',
            expectedIndices: [2, 3, 4],  // splitRows + split + splitWrapper (contains splitRows)
        },
        {
            description: 'returns segment-call assignment when the segment contains the call internally',
            callableName: 'transform',
            expectedIndices: [5],     // noSplitWrapper contains transform internally
        },
        {
            description: 'returns only the fit assignment when searching for fit',
            callableName: 'fit',
            expectedIndices: [6],
        },
    ];

    it.each(cases)('$description', ({ callableName, expectedIndices }) => {
        const result = analyzer.extractAssignmentsWithSpecificCall(sharedStatements, callableName);
        // Compare by reference — toStrictEqual deep-compares cyclic AST nodes
        expect(result.length).toBe(expectedIndices.length);
        result.forEach((stmt, i) => expect(stmt).toBe(sharedStatements[expectedIndices[i]!]));
    })
});

// ---------------------------------------------------------------------------
// expandCallsInStatement
// ---------------------------------------------------------------------------

describe('expandCallsInStatement', () => {
    it('returns a direct function call paired with an empty paramArgMap', async () => {
        const code = `
            package test
            fun getTable() -> result: Table
            fun fit(t: Table) -> result: Classifier
            pipeline p {
                val t = getTable();
                val r = fit(t);
            }
        `;
        const pipeline = await getNodeOfType(services, code, isSdsPipeline);
        const fitStatement = pipeline.body.statements[1]!;

        const result = analyzer.expandCallsInStatement(fitStatement);

        expect(result).toHaveLength(1);
        const callable = services.helpers.NodeMapper.callToCallable(result[0]!.call);
        expect(isSdsFunction(callable) && callable.name).toBe('fit');
        expect(result[0]!.paramArgMap.size).toBe(0);
    });

    it('expands a segment call and binds the segment parameter to the call-site argument', async () => {
        const code = `
            package test
            fun getTable() -> result: Table
            fun fit(t: Table) -> result: Classifier
            segment mySegment(data: Table) -> result: Classifier {
                val r = fit(data)
                yield result = r
            }
            pipeline p {
                val t = getTable();
                val r = mySegment(t);
            }
        `;
        const pipeline = await getNodeOfType(services, code, isSdsPipeline);
        const segmentStatement = pipeline.body.statements[1]!;

        const result = analyzer.expandCallsInStatement(segmentStatement);

        // The segment call is inlined: only the inner fit call is returned
        expect(result).toHaveLength(1);
        const callable = services.helpers.NodeMapper.callToCallable(result[0]!.call);
        expect(isSdsFunction(callable) && callable.name).toBe('fit');

        // paramArgMap binds segment parameter 'data' to the pipeline placeholder 't'
        const paramEntry = [...result[0]!.paramArgMap.entries()].find(([p]) => p.name === 'data');
        expect(paramEntry).toBeDefined();
        const boundExpr = paramEntry![1];
        expect(isSdsReference(boundExpr)).toBe(true);
        if (!isSdsReference(boundExpr)) return;  // for type narrowing
        expect(isSdsPlaceholder(boundExpr.target.ref)).toBe(true);
        expect(boundExpr.target.ref?.name).toBe('t');
    });

    it('returns chained function calls innermost first', async () => {
        const code = `
            package test
            fun getTable() -> result: Table
            fun process(t: Table) -> result: Table
            fun fit(t: Table) -> result: Classifier
            pipeline p {
                val t = getTable();
                val r = fit(process(t));
            }
        `;
        const pipeline = await getNodeOfType(services, code, isSdsPipeline);
        const chainedStatement = pipeline.body.statements[1]!;

        const result = analyzer.expandCallsInStatement(chainedStatement);

        // Both are function calls; innermost (process) comes first
        expect(result).toHaveLength(2);
        const first = services.helpers.NodeMapper.callToCallable(result[0]!.call);
        const second = services.helpers.NodeMapper.callToCallable(result[1]!.call);
        expect(isSdsFunction(first) && first.name).toBe('process');
        expect(isSdsFunction(second) && second.name).toBe('fit');
    });

    it('threads paramArgMap through nested segment calls', async () => {
        const code = `
            package test
            fun getTable() -> result: Table
            fun fit(t: Table) -> result: Classifier
            segment inner(x: Table) -> result: Classifier {
                val r = fit(x)
                yield result = r
            }
            segment outer(data: Table) -> result: Classifier {
                val r = inner(data)
                yield result = r
            }
            pipeline p {
                val t = getTable();
                val r = outer(t);
            }
        `;
        const pipeline = await getNodeOfType(services, code, isSdsPipeline);
        const outerStatement = pipeline.body.statements[1]!;

        const result = analyzer.expandCallsInStatement(outerStatement);

        // Both segments inlined: only the innermost fit call survives
        expect(result).toHaveLength(1);
        const callable = services.helpers.NodeMapper.callToCallable(result[0]!.call);
        expect(isSdsFunction(callable) && callable.name).toBe('fit');

        // The outer binding (outer.data → t) is substituted through to inner.x
        const paramEntry = [...result[0]!.paramArgMap.entries()].find(([p]) => p.name === 'x');
        expect(paramEntry).toBeDefined();
        const boundExpr = paramEntry![1];
        expect(isSdsReference(boundExpr)).toBe(true);
        if (!isSdsReference(boundExpr)) return;  // for type narrowing
        expect(isSdsPlaceholder(boundExpr.target.ref)).toBe(true);
        expect(boundExpr.target.ref?.name).toBe('t');
    });
});

// ---------------------------------------------------------------------------

interface IsDataTest {
    description: string;
    code: string;
    expected: boolean;
}

interface IsSpecificCallTest {
    description: string;
    statementIndex: number;
    callableName: string;
    expected: boolean;
}

interface ExtractAssignmentsTest {
    description: string;
    callableName: string;
    expectedIndices: number[];
}
