import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsCall, SdsPlaceholder, SdsStatement, isSdsBlock, isSdsPlaceholder, isSdsStatement, isSdsAssignment, SdsAssignee, isSdsCall, isSdsFunction, isSdsReference, SdsAssignment, isSdsObject } from '../../generated/ast.js';
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
        if (!targetStatement || !isSdsAssignment(targetStatement)) {
            return;
        }

        // Check if this placeholder is assigned by a 'fit' call
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
            // Trigger validation if call was a 'splitRows' call
            accept('warning', 'Testing Dataset should not be used to train a Model', {
                node: node,
                property: 'argumentList',
                code: CODE_TEST_DATA_USED_FOR_TRAINING,
                data: { path: locator.getAstNodePath(node) },
            });
        }
    };
}