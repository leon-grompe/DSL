import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsCall, isSdsFunction, isSdsReference, isSdsPlaceholder } from '../../generated/ast.js';


export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';


export const testDataUsedForTraining = (services: SafeDsServices) => {
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
            
            const placeholders : SdsPlaceholder[] = [];
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