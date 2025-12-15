import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsCall, SdsObject ,SdsStatement, isSdsBlock, isSdsStatement, isSdsAssignment, isSdsCall, isSdsFunction, isSdsReference, isSdsArgument, SdsReference, isSdsPlaceholder } from '../../generated/ast.js';
import { SafeDsSlicer } from '../../flow/safe-ds-slicer.js';
import { AstUtils } from 'langium';
import { getStatements, getAssignees, getArguments } from '../../helpers/nodeProperties.js';



export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';


export const testDataUsedForTraining = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const slicer = services.flow.Slicer;
    
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
            
            console.log(' ==================');
            console.log('Investigating: ' + refPlacehldr.name + ' , ' + refPlacehldr.$type);
            let placeholders = new Array<SdsPlaceholder>();
            let result = slicer.checkIfArgumentIsAssigneeOfSpecificFunction(refPlacehldr,'splitRows',1,services, placeholders);
            if(result){
                accept('warning', 'Testing Dataset should not be used to train a Model', {
                    node: node,
                    property: 'argumentList',
                    code: CODE_TEST_DATA_USED_FOR_TRAINING,
                    data: { path: locator.getAstNodePath(node) },
                });
            }

            for (const placeholder of placeholders){
                console.log(placeholder.name + ' , ' + placeholder.$type);
                
            }
        }

        

    }
}