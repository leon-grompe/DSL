import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsStatement, isSdsBlock, isSdsPlaceholder } from '../../generated/ast.js';
import { SafeDsSlicer } from '../../flow/safe-ds-slicer.js';
import { AstUtils } from 'langium';
import { getStatements } from '../../helpers/nodeProperties.js';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';

export const testDataUsedForTraining = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const slicer = new SafeDsSlicer(services);
    
    return (node: SdsStatement, accept: ValidationAcceptor) => {
        // get statements to use in slicer
        const containingBlock = AstUtils.getContainerOfType(node, isSdsBlock);
        const statements = getStatements(containingBlock);
        const targets = [node]
        
        for (const statement of slicer.computeBackwardSliceToTargetsWithoutPurity(statements, targets)){
            

            accept('warning', 'Testing Dataset should not be used for Training', {
                node: statement,
                property: 'name',
                code: CODE_TEST_DATA_USED_FOR_TRAINING,
                data: { path: locator.getAstNodePath(node) },
            });
        }
    }
}