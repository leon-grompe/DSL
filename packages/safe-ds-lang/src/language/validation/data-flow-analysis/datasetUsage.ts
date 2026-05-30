import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsCall, SdsPipeline, isSdsReference, isSdsPlaceholder, isSdsAssignment, SdsLocalVariable, isSdsLocalVariable, isSdsSegment } from '../../generated/ast.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';


export const testDataUsedForTraining = (services: SafeDsServices) => {
    const analyzer = services.flow.DataFlowAnalyzer;
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
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
                        message = `Only the training dataset ('${trainingSetName}') should be used for fitting.`;
                    }
                    accept('warning',
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