import { AstUtils, ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsCall, SdsPipeline, isSdsReference, isSdsPlaceholder, isSdsAssignment, SdsLocalVariable, isSdsSegment } from '../../generated/ast.js';
import { DataSet } from '../../flow/safe-ds-dataset-identifier.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';
export const CODE_REST_DATA_USED_FOR_NON_SPLITTING = 'data-flow-analysis/rest-data-used-for-non-splitting';

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
            const callable = nodeMapper.callToCallable(call);

            for (const argument of call.argumentList.arguments) {
                if (!isSdsReference(argument.value)) continue;
                const argRef = argument.value.target.ref;

                // Only data placeholders can be a fitting target; ignore everything else
                if (!isSdsPlaceholder(argRef) || !analyzer.isData(argRef)) continue;

                // A placeholder derived from the training set is exactly what we want — skip it
                if (forwardVariables.some((variable) => variable === argRef)) continue;

                const message = isSdsSegment(callable)
                    ? `This segment makes use of a '.fit()' call which does not use a dataset derived from the training set ('${trainingSetName}').`
                    : `Only placeholders derived from the training set ('${trainingSetName}') should be used for fitting.`;

                accept('error', message, {
                    node: argument,
                    property: 'value',
                    // point at the reference itself (not its target declaration) so the quickfix can swap it
                    code: CODE_TEST_DATA_USED_FOR_TRAINING,
                    data: { path: locator.getAstNodePath(argument.value), expected: DataSet.Training },
                });
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