import { AstUtils, ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsCall, SdsPipeline, isSdsReference, isSdsPlaceholder, isSdsAssignment, SdsLocalVariable, isSdsSegment } from '../../generated/ast.js';

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