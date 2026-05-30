import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsCall, SdsPipeline, isSdsReference, isSdsPlaceholder, isSdsAssignment } from '../../generated/ast.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';


export const testDataUsedForTraining = (services: SafeDsServices) => {
    const analyzer = services.flow.DataFlowAnalyzer;
    const locator = services.workspace.AstNodeLocator;

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

        // Compute all forward references of the training set
        const forwardVariables = services.flow.Slicer.computeForwardSliceFromVariable(trainingSetPlaceholder as SdsPlaceholder);

        for (const call of fitCalls) {
            const argumentArray = call.argumentList.arguments;
            for (const argument of argumentArray) {
                if (!isSdsReference(argument.value)) continue;
                const argRef = argument.value.target.ref;
                
                // Skip non-data variables
                if (!isSdsPlaceholder(argRef) || !analyzer.isData(argRef)) continue;

                // Skip if 'argRef' references a variable in the forward slice of the training set
                if (forwardVariables.some(variable => variable === argRef)) {
                    continue;
                } else {
                    accept('warning',
                        `Only the training dataset ('${argument.$cstNode?.text}') should be used for fitting.`, {
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