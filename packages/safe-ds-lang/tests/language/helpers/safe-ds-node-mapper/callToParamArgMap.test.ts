import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { isSdsCall, isSdsModule, SdsCall } from '../../../../src/language/generated/ast.js';
import { createSafeDsServices, getArguments } from '../../../../src/language/index.js';
import { getNodeOfType } from '../../../helpers/nodeFinder.js';
import { AstUtils } from 'langium';

const services = (await createSafeDsServices(EmptyFileSystem, { omitBuiltins: true })).SafeDs;
const nodeMapper = services.helpers.NodeMapper;

const code = `
    fun f(p1: Int, p2: Int)
    pipeline myPipeline {
        f();
        f(1, 2);
        f(1, 2, 3);
        f(p2 = 1, 2);
        f(p2 = 1, p1 = 2);
        f(notAParam = 1);
    }
`;
const module = await getNodeOfType(services, code, isSdsModule);

const calls = AstUtils.streamAllContents(module).filter(isSdsCall).toArray() as SdsCall[];
const [emptyCall, positionalCall, excessCall, positionalAfterNamedCall, namedCall, unresolvedCall] = calls;

const testCases: CallToParamArgMapTest[] = [
    {
        testName: 'empty call',
        call: emptyCall!,
        expectedSize: 0,
    },
    {
        testName: 'positional arguments',
        call: positionalCall!,
        expectedSize: 2,
    },
    {
        testName: 'excess positional arguments',
        call: excessCall!,
        expectedSize: 2,
    },
    {
        testName: 'positional argument after named argument',
        call: positionalAfterNamedCall!,
        expectedSize: 1,
    },
    {
        testName: 'named arguments in any order',
        call: namedCall!,
        expectedSize: 2,
    },
    {
        testName: 'unresolved parameter name',
        call: unresolvedCall!,
        expectedSize: 0,
    },
];

describe('SafeDsNodeMapper', () => {
    describe.each(testCases)('callToParamArgMap', ({ testName, call, expectedSize }) => {
        it(testName, () => {
            const map = nodeMapper.callToParamArgMap(call);
            expect(map.size).toBe(expectedSize);

            // Delegation: each resolvable argument must appear in the map under the same parameter
            // that argumentToParameter returns for it
            for (const arg of getArguments(call)) {
                const param = nodeMapper.argumentToParameter(arg);
                if (param) {
                    expect(map.get(param)).toBe(arg);
                }
            }
        });
    });
});

/**
 * A test case for {@link SafeDsNodeMapper.callToParamArgMap}.
 */
interface CallToParamArgMapTest {
    testName: string;
    call: SdsCall;
    expectedSize: number;
}
