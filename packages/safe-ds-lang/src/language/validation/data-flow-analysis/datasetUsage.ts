import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsCall, isSdsFunction, isSdsReference, isSdsPlaceholder, SdsPipeline, isSdsAssignment } from '../../generated/ast.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';


export const testDataUsedForTraining = (services: SafeDsServices) => {
    const analyzer = services.flow.DataFlowAnalyzer;
    const locator = services.workspace.AstNodeLocator;

    // TODO:
    // IF THE ERROR OCCURS INSIDE A SEGMENT, WE SHOULD SHOW THE VALIDATION ON THE ARGUMENT IN THE SEGMENT CALL (not the segment body)
    // ADJUST LINE NUMBER IN VALIDATION MESSAGE FOR 0-BASED LINE NUMBERS

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
        console.log("SLICE")
        console.log(forwardVariables.map(v => v.$cstNode?.text))
        console.log(forwardVariables.map(v => v.$type))
        for (const call of fitCalls) {
            const argumentArray = call.argumentList.arguments;
            for (const argument of argumentArray) {
                if (forwardVariables.some(variable =>
                    isSdsReference(argument.value) &&
                    variable === argument.value.target.ref)) {
                        continue;
                } else {
                    accept('warning',
                        `Only the training dataset (first assignee in line ${trainingSetPlaceholder?.$cstNode?.range.start.line}) should be used for fitting.`, {
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


export const testDataUsedForTraining1 = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const analyzer = services.flow.DataFlowAnalyzer;

    return (node: SdsCall, accept: ValidationAcceptor) => {
        // Check if node is 'fit' call
        const nodesCallable = nodeMapper.callToCallable(node);
        if (!isSdsFunction(nodesCallable) || nodesCallable.name !== 'fit') {
            return;
        }

        const argList = node.argumentList.arguments;
        for (const arg of argList){
            if (!isSdsReference(arg.value)){
                continue;
            }
            const refPlacehldr = arg.value.target.ref;
            if (!isSdsPlaceholder(refPlacehldr)){continue;}

            const placeholders: SdsPlaceholder[] = [];
            const found = analyzer.checkIfPlaceholderIsAssigneeOfSpecificFunction(refPlacehldr, 'splitRows', 1, placeholders);

            // If found, try to pick the most specific placeholder collected; fall back to the original
            const problemPlaceholder = found ? (placeholders[placeholders.length - 1] ?? refPlacehldr) : null;

            // account for 0-based line numbers
            const line = (problemPlaceholder?.$cstNode?.range.start.line ?? 0) + 1;

            if (found) {
                accept('warning', `Testing Dataset resulting from Assignment of Placeholder '${problemPlaceholder?.name}' in line ${line} should not be used to train a Model`, {
                    node: node,
                    property: 'argumentList',
                    code: CODE_TEST_DATA_USED_FOR_TRAINING,
                    data: { path: locator.getAstNodePath(node) },
                });
            }
        }
    }
}
