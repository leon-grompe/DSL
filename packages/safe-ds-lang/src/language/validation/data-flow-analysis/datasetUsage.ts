import { AstUtils, ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsCall, SdsPipeline, isSdsReference, isSdsPlaceholder, isSdsAssignment, isSdsFunction, SdsLocalVariable, isSdsSegment } from '../../generated/ast.js';
import { getArguments, getParameters } from '../../helpers/nodeProperties.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';
export const CODE_REST_DATA_USED_FOR_NON_SPLITTING = 'data-flow-analysis/rest-data-used-for-non-splitting';
export const CODE_INCONSISTENT_DATASET_ARGUMENTS = 'data-flow-analysis/inconsistent-dataset-arguments';

export const testDataUsedForTraining = (services: SafeDsServices) => {
    const analyzer = services.flow.DataFlowAnalyzer;
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    
    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        if (!node.body) return;
        
        const pipelineStatements = node.body.statements;
        const assignments = pipelineStatements.filter(isSdsAssignment);

        // Extract assignments with split calls
        const splitAssignments = analyzer.extractAssignmentsWithSpecificCall(assignments, 'split');

        // Extract training calls
        const fitAssignments = analyzer.extractAssignmentsWithSpecificCall(assignments, 'fit');
        const fitCalls = fitAssignments.map(assignment => assignment.expression as SdsCall);

        // Determine placeholder to compute forward slice from
        const trainingSetPlaceholder = splitAssignments[0]?.assigneeList?.assignees[0];
        const trainingSetName = trainingSetPlaceholder?.$cstNode?.text.slice(4)

        // Compute all forward references of the training set
        const forwardVariables = services.flow.Slicer.computeForwardSliceFromVariable(trainingSetPlaceholder as SdsLocalVariable);

        for (const call of fitCalls) {
            const argumentArray = call.argumentList.arguments;
            const callable = nodeMapper.callToCallable(call);
            
            for (const argument of argumentArray) {
                if (!isSdsReference(argument.value)) continue;
                const argRef = argument.value.target.ref;
                
                // Skip non-data variables
                if (!isSdsPlaceholder(argRef) || !analyzer.isData(argRef)) continue;

                // Skip if 'argRef' references a variable in the forward slice of the training set
                if (forwardVariables.some(variable => variable === argRef)) {
                    continue;
                } else {
                    let message: string = ``;
                    if (isSdsSegment(callable)) {
                        message = `This segment makes use of a '.fit()' call wich does not use a dataset derived from the training set ('${trainingSetName}').`
                    } else {
                        message = `Only placeholders derived from the training set ('${trainingSetName}') should be used for fitting.`;
                    }
                    accept('error',
                        message, {
                        node: argument,
                        property: 'value',
                        code: CODE_TEST_DATA_USED_FOR_TRAINING,
                        data: { path: locator.getAstNodePath(argument) },
                    });
                }
            }
        }
    }
}

export const restDataUsedForNonSplitting = (services: SafeDsServices) => {
    const analyzer = services.flow.DataFlowAnalyzer;
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const identifier = services.flow.DatasetIdentifier;

    // recognize when the rest set is used for anything other than splitting
    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        if (!node.body) return;
        
        const assignments = node.body.statements.filter(isSdsAssignment);

        const restSetPlaceholder = identifier.getChainedRestSetPlaceholder(assignments);
        if (!restSetPlaceholder) return;

        // a "split" feed can be a direct split call or a segment call that performs a split internally, so
        // we match the same set of assignments that identify the chained split in the first place. Using
        // isSpecificCall alone would miss the segment-call case and wrongly flag the rest set feeding it.
        const splitAssignments = new Set(analyzer.extractAssignmentsWithSpecificCall(assignments, 'split'));

        // every usage of the rest set should feed a second split; anything else is flagged
        nodeMapper.placeholderToReferences(restSetPlaceholder).forEach((reference) => {
            const containingStatement = AstUtils.getContainerOfType(reference, isSdsAssignment);
            if (containingStatement && splitAssignments.has(containingStatement)) return;

            accept('warning',
                `The rest set ('${restSetPlaceholder.name}') should only be used for a second split, not for anything else.`, {
                node: reference,
                code: CODE_REST_DATA_USED_FOR_NON_SPLITTING,
                data: { path: locator.getAstNodePath(reference) },
            });
        });
    }
}

export const toTabularDatasetMustUseSameArguments = (services: SafeDsServices) => {
    const analyzer = services.flow.DataFlowAnalyzer;
    const nodeMapper = services.helpers.NodeMapper;
    const partialEvaluator = services.evaluation.PartialEvaluator;
    const locator = services.workspace.AstNodeLocator;

    // 'toTabularDataset' only assigns column roles (target/extra/features) — it learns nothing from the
    // data, so it is not leakage-prone. But the schema it produces must be identical for every dataset
    // partition; diverging target/extra columns mean the model is fit and evaluated on different schemas.
    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // collect every distinct 'toTabularDataset' call in the pipeline, flattening segment calls.
        // a segment-internal call reused for several datasets is a single source node, so it is
        // consistent with itself — only distinct call sites can actually disagree.
        const calls: SdsCall[] = [];
        const seen = new Set<SdsCall>();
        
        if (!node.body) return;
        for (const statement of node.body.statements) {
            for (const { call } of analyzer.expandCallsInStatement(statement)) {
                const callable = nodeMapper.callToCallable(call);
                if (isSdsFunction(callable) && callable.name === 'toTabularDataset' && !seen.has(call)) {
                    seen.add(call);
                    calls.push(call);
                }
            }
        }
        if (calls.length < 2) return;

        // resolve the target and extra arguments to canonical value strings via the partial evaluator,
        // so named/positional forms and omitted defaults (e.g. 'extraNames = null') compare equal.
        const argsToStringValues = (call: SdsCall): { target: string; extra: string } => {
            const substitutions = partialEvaluator.computeParameterSubstitutionsForCall(call);
            const parameters = getParameters(nodeMapper.callToCallable(call));
            
            const stringValueOf = (parameterName: string): string => {
                const parameter = parameters.find((it) => it.name === parameterName);
                return parameter ? substitutions.get(parameter)?.toString() ?? '?' : '?';
            };
            return { target: stringValueOf('targetName'), extra: stringValueOf('extraNames') };
        };

        // the first call (in document order) is the reference; flag every call that disagrees with it.
        const reference = argsToStringValues(calls[0]!);
        for (const call of calls.slice(1)) {
            const current = argsToStringValues(call);
            if (current.target === reference.target && current.extra === reference.extra) continue;

            accept('warning',
                `All 'toTabularDataset' calls in a pipeline must have the same arguments. \n` +
                `This call uses 'targetName = ${current.target}, extraNames = ${current.extra}', but the ` + 
                `reference call uses \n'targetName = ${reference.target}, extraNames = ${reference.extra}'.`, {
                node: call,
                code: CODE_INCONSISTENT_DATASET_ARGUMENTS,
                data: { path: locator.getAstNodePath(call) },
            });
        }
    }
}