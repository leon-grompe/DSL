import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsStatement, isSdsBlock, isSdsPlaceholder, isSdsStatement, isSdsAssignment, SdsAssignee, isSdsCall, isSdsFunction, SdsArgument, SdsArgumentList, SdsAssignment, isSdsExpression } from '../../generated/ast.js';
import { SafeDsSlicer } from '../../flow/safe-ds-slicer.js';
import { AstUtils } from 'langium';
import { getStatements, getAssignees, getArguments } from '../../helpers/nodeProperties.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';

export const testDataUsedForTraining = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const slicer = new SafeDsSlicer(services);
    
    return (node: SdsPlaceholder, accept: ValidationAcceptor) => {
        // find the statement that actually declares/contains this placeholder
        const targetStatement = AstUtils.getContainerOfType(node, isSdsStatement) as SdsStatement | undefined;
        
        // find statements with a 'fit' call
        if(!isSdsAssignment(targetStatement)) {
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
        
        // target statement must now contain the 'fit' call
        const targets = [targetStatement];

        // find the block and statements where the slicer should operate
        const containingBlock = AstUtils.getContainerOfType(targetStatement, isSdsBlock);
        const statements = getStatements(containingBlock);
        
        // backward sice for statements with 'fit' call
        const backwardSlice = slicer.computeBackwardSliceToTargetsWithoutPurity(statements, targets);
        
        const assignees = new Set<SdsAssignee>();
        for (const statement of backwardSlice) {
            if (!isSdsAssignment(statement)) {
                continue;
            }
            for (const assignee of getAssignees(statement)) {
                assignees.add(assignee);
            }
        }
        // check if any of the arguments to 'fit' come from a 'splitRows' call
        for (const statement of backwardSlice) {
            if (!isSdsAssignment(statement)) {
                continue;
            }
            if (!isSdsCall(statement.expression)) {
                continue;
            }
            for (const argument of getArguments(statement.expression)) {
                for (const assignee of assignees){
                    const assignedObject = nodeMapper.assigneeToAssignedObject(assignee);
                    if (!isSdsExpression(assignedObject)){
                        continue;
                    }
                    if (!isSdsCall(assignedObject)){
                        continue;
                    }
                    // statement is a call, check if it's a 'splitRows' call
                    const assignedCallable = nodeMapper.callToCallable(assignedObject);
                    if (!isSdsFunction(assignedCallable) || assignedCallable.name !== 'splitRows'){
                    }
                    // if the argument's CST node is the same as the assignee's CST node, we have a match
                    if(argument.$cstNode == assignee.$cstNode) {
                        accept('warning', 'Testing Dataset should not be used to train a Model', {
                            node: argument,
                            property: 'value',
                            code: CODE_TEST_DATA_USED_FOR_TRAINING,
                            data: { path: locator.getAstNodePath(node) },
                        });
                    }
                }
            }         
        }
    };
}