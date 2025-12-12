import { ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsCall, SdsStatement, isSdsBlock, isSdsStatement, isSdsAssignment, isSdsCall, isSdsFunction, isSdsReference, isSdsArgument, SdsReference, isSdsPlaceholder } from '../../generated/ast.js';
import { SafeDsSlicer } from '../../flow/safe-ds-slicer.js';
import { AstUtils } from 'langium';
import { getStatements, getAssignees, getArguments } from '../../helpers/nodeProperties.js';
import { SafeDsCodeLensProvider } from '../../lsp/safe-ds-code-lens-provider.js';

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
            slicer.checkIfArgumentIsAssigneeOfSpecificFunction(refPlacehldr,'splitRows',1,services, placeholders);

            for (const placeholder of placeholders){
                console.log(placeholder.name + ' , ' + placeholder.$type);
                
            }
        }
        

        accept('warning', 'Testing Dataset should not be used to train a Model', {
            node: node,
            property: 'argumentList',
            code: CODE_TEST_DATA_USED_FOR_TRAINING,
            data: { path: locator.getAstNodePath(node) },
        });

    }
}
/*
export const testDataUsedForTraining = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const slicer = services.flow.Slicer;
    
    return (node: SdsCall, accept: ValidationAcceptor) => {
        // Find the statement that actually declares/contains this placeholder
        const targetStatement = AstUtils.getContainerOfType(node, isSdsStatement) as SdsStatement | undefined;
        
        // Check if target statement is 'fit' call
        if (isSdsAssignment(targetStatement)) {
            const targetsExpression = targetStatement.expression;
            if (!isSdsCall(targetsExpression)) {
                return;
            }
            const targetsCallable = nodeMapper.callToCallable(targetsExpression);
            if (!isSdsFunction(targetsCallable) || targetsCallable.name !== 'fit') {
                return;
            }
        } else { return }
        
        // Find the block and statements where the slicer should operate
        const containingBlock = AstUtils.getContainerOfType(targetStatement, isSdsBlock);
        const statementsInBlock = getStatements(containingBlock);

        // Compute backward slice from the 'fit' call
        const targets = [targetStatement];
        const backwardSlice = slicer.computeBackwardSliceToTargetsWithoutPurity(statementsInBlock, targets);

        // Iterate over backwardSlice to find 'splitRows' calls
        for (const statement of backwardSlice) {
            
            // Check if statement is 'splitRows' call
            if (isSdsAssignment(statement)) {
                
                const expr = statement.expression;
                if (!isSdsCall(expr)){
                    continue;
                }
                const callable = nodeMapper.callToCallable(expr);
                if (!isSdsFunction(callable) || callable.name !== 'splitRows') {
                    continue;
                }
            } else { continue }     
        
            const assignees = getAssignees(statement);
            if (!assignees){
                continue;
            }
            const testData = assignees[1];

            // Get the argument value (which should be a reference to a placeholder)
            const argument = getArguments(node)[0];
            if (!argument || !argument.value || !isSdsReference(argument.value)) {
                continue;
            }
            const referencedDeclaration = argument.value.target.ref as SdsPlaceholder;
            if(!referencedDeclaration){
                continue;
            }
            
            /*
            const references = nodeMapper.placeholderToReferences(testData as SdsPlaceholder)
            
            // PROBLEM: only triggers on direct reference match, 
            // and triggers multiple times on same call argument
            for (const rfrnc of references){
                if (rfrnc.target.ref === referencedDeclaration){
                    accept('warning', 'Testing Dataset should not be used to train a Model', {
                        node: node,
                        property: 'argumentList',
                        code: CODE_TEST_DATA_USED_FOR_TRAINING,
                        data: { path: locator.getAstNodePath(node) },
                    });
                }
            }
            
            
            // PROBLEM: only triggers validation from direct references
            if (testData === referencedDeclaration) {
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
*/