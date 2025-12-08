import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsCall, SdsExpression, SdsStatement, isSdsBlock, isSdsPlaceholder, isSdsStatement, isSdsAssignment, SdsAssignee, isSdsCall, isSdsFunction, isSdsReference, SdsAssignment, isSdsObject } from '../../generated/ast.js';
import { SafeDsSlicer } from '../../flow/safe-ds-slicer.js';
import { AstUtils } from 'langium';
import { getStatements, getAssignees, getArguments } from '../../helpers/nodeProperties.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';

export const testDataUsedForTraining = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const slicer = new SafeDsSlicer(services);
    
    return (node: SdsCall, accept: ValidationAcceptor) => {
        // Find the statement that actually declares/contains this placeholder
        const targetStatement = AstUtils.getContainerOfType(node, isSdsStatement) as SdsStatement | undefined;
        if (!isSdsAssignment(targetStatement)) {
            return;
        }
        const targetsExpression = targetStatement.expression;
        if (!isSdsCall(targetsExpression)) {
            return;
        }
        const targetsCallable = nodeMapper.callToCallable(targetsExpression);
        if (!isSdsFunction(targetsCallable) || targetsCallable.name !== 'fit') {
            return;
        }

        // Find the block and statements where the slicer should operate
        const containingBlock = AstUtils.getContainerOfType(targetStatement, isSdsBlock);
        const statements = getStatements(containingBlock);

        // Compute backward slice from the 'fit' call
        const targets = [targetStatement];
        const backwardSlice = slicer.computeBackwardSliceToTargetsWithoutPurity(statements, targets);

        // Create sets of assignees and expressions
        let assigneesOfSlice = new Set<SdsAssignee>();
        let expressionsOfSlice = new Set<SdsExpression>();
        for (const statement of backwardSlice){
            if (!isSdsAssignment(statement) || !statement.assigneeList || !statement.expression){
                continue;
            }
            // add assignees
            for (const assignee of statement.assigneeList.assignees){
                assigneesOfSlice.add(assignee);
            }
            // add expressions
            expressionsOfSlice.add(statement.expression);
        }

        // Iterate over bacwardSlice to find 'splitRows' calls
        for (const statement of backwardSlice) {
            if (!isSdsAssignment(statement)) {
                continue;
            }
            const expr = statement.expression;
            if (!isSdsCall(expr)){
                continue;
            }
            const callable = nodeMapper.callToCallable(expr);
            if (!isSdsFunction(callable) || callable.name !== 'splitRows') {
                continue;
            }

            const assignees = statement.assigneeList?.assignees;
            if (!assignees || !assignees[1]){
                continue;
            }

            // Get the argument value (which should be a reference to a placeholder)
            const argument = node.argumentList?.arguments[0];
            if (!argument || !argument.value || !isSdsReference(argument.value)) {
                continue;
            }
            const referencedDeclaration = argument.value.target.ref;
            if(!referencedDeclaration){
                continue;
            }

            // PROBLEM: now triggers validation for all calls of fit again
            for (const currentAssignee of assigneesOfSlice){
                if (currentAssignee === referencedDeclaration){
                    accept('warning', 'Testing Dataset should not be used to train a Model', {
                        node: argument,
                        property: 'value',
                        code: CODE_TEST_DATA_USED_FOR_TRAINING,
                        data: { path: locator.getAstNodePath(argument) },
                    });
                }
            }
            if (assignees[1] === referencedDeclaration) {
                accept('warning', 'Testing Dataset should not be used to train a Model', {
                    node: argument,
                    property: 'value',
                    code: CODE_TEST_DATA_USED_FOR_TRAINING,
                    data: { path: locator.getAstNodePath(argument) },
                });
            }
        }
    };
}