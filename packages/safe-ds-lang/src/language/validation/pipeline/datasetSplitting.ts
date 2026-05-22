import { AstUtils, ValidationAcceptor } from 'langium';
import { isSdsCall, isSdsFunction, isSdsPlaceholder, SdsAssignment, SdsPipeline, isSdsAssignment, isSdsReference } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';

export const CODE_DATASET_SPLITTING = 'pipeline/dataset-splitting';

export const pipelineShouldContainMultipleSplits = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;
    const analyzer = services.flow.DataFlowAnalyzer;
    
    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        const splitStatements: SdsAssignment[] = [];
        
        for (const statement of node.body.statements) {
            if (!isSdsAssignment(statement)) continue;
            
            for (const call of nodeMapper.statementToCalls(statement).map(({ call }) => call)) {

                if (!isSdsCall(call)) continue;
                const callable = nodeMapper.callToCallable(call);
                
                if (callable && isSdsFunction(callable) && callable.name === 'splitRows') {
                    splitStatements.push(statement);
                }
            }
        }

        // only one split -> recommend another
        if (splitStatements.length === 1) {
            accept( 'info',
                'Splitting the original data into 3 parts (training, validation, test) is recommended.', {
                    node: splitStatements[0]?.expression ?? node,
                    code: CODE_DATASET_SPLITTING
                }
            )
            return;
        }

        // flag to check if there are splits that reference each other
        let hasChainedSplit = false;
        
        // multiple splits
        for (const assignment of splitStatements) {
            const assignees = assignment.assigneeList?.assignees ?? [];

            for (const otherAssignment of splitStatements) {
                if (assignment === otherAssignment) continue;

                AstUtils.streamAllContents(otherAssignment).forEach(astNode => {
                    if (isSdsReference(astNode) && isSdsPlaceholder(astNode.target.ref)) {
                        // otherAssignment references another split at position 1 (correct)
                        if (assignees[1] === astNode.target.ref){
                            hasChainedSplit = true;
                        }
                        // otherAssignment references another split at another position (incorrect)
                        else if (assignees.includes(astNode.target.ref)){
                            hasChainedSplit = true;
                            accept( 'info',
                                'Only the second assignee (which combines test and validation data) should be split a second time.', {
                                    node: otherAssignment.expression ?? node,
                                    code: CODE_DATASET_SPLITTING
                                }
                            )
                        }
                    }
                })
            }
        }

        // mutiple splits, but no split references another
        if (!hasChainedSplit) {
            accept('info',
                'Splitting the original data into 3 parts (training, validation, test) is recommended.', {
                    node: splitStatements[0] ?? node,
                    code: CODE_DATASET_SPLITTING
                }
            );
        }
    }
}