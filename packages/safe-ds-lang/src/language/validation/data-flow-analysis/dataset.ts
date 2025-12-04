import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsStatement, isSdsBlock, isSdsPlaceholder, isSdsStatement, isSdsAssignment, SdsAssignee } from '../../generated/ast.js';
import { SafeDsSlicer } from '../../flow/safe-ds-slicer.js';
import { AstUtils } from 'langium';
import { getStatements, getAssignees } from '../../helpers/nodeProperties.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';

export const testDataUsedForTraining = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const slicer = new SafeDsSlicer(services);
    
    return (node: SdsPlaceholder, accept: ValidationAcceptor) => {
        // find the block and statements where slicer should operate
        const containingBlock = AstUtils.getContainerOfType(node, isSdsBlock);
        const statements = getStatements(containingBlock);

        // find the statement that actually declares/contains this placeholder
        const targetStatement = AstUtils.getContainerOfType(node, isSdsStatement) as SdsStatement | undefined;
        if (!targetStatement) {
            // nothing we can slice from
            return;
        }

        const targets = [targetStatement];
        console.log('=====================')
        console.log('slicing for test data placeholder', node.name);
        for (const statement of slicer.computeBackwardSliceToTargetsWithoutPurity(statements, targets)) {
            // We only care about assignments that bind placeholders.
            if (!isSdsAssignment(statement)) continue;

            console.log('  checking statement', statement.$cstNode?.text);

            const assignees = getAssignees(statement);
            for (const assigned of assignees) {
                console.log('  assignment to', assigned.$cstNode?.text);
            }
            const placeholderAssignee = assignees.find((it) => isSdsPlaceholder(it)) as SdsPlaceholder | undefined;
            if (!placeholderAssignee) continue;

            // Emit diagnostic on the placeholder itself so the user sees the precise symbol.
            accept('warning', 'Testing Dataset should not be used to train a Model', {
                node: placeholderAssignee,
                property: 'name',
                code: CODE_TEST_DATA_USED_FOR_TRAINING,
                data: { path: locator.getAstNodePath(node) },
            });
        }
    };
}